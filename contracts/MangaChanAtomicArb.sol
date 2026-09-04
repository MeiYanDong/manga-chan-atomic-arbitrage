// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Minimal interfaces kept local so the deployed runtime only contains
/// the exact MANGA CHAN route that has been reviewed.
interface IUniswapV3PoolMinimal {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

interface IUniswapV3SwapRouterMinimal {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

interface IPoolManagerMinimal {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    function unlock(bytes calldata data) external returns (bytes memory result);
    function sync(address currency) external;
    function settle() external payable returns (uint256 paid);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData)
        external
        returns (int256 delta);
    function take(address currency, address to, uint256 amount) external;
}

/// @title MANGA CHAN MSFT -> MANGA -> NVDA atomic arbitrage executor
/// @notice Holds a small USDG float and executes one fixed, fully atomic route:
/// USDG -(V3)-> MSFT -(V4)-> MANGA -(V4)-> NVDA -(V3)-> USDG.
/// Every external target and pool key is fixed in bytecode. A losing route
/// reverts, returning all pool state and token transfers to their prior state.
contract MangaChanAtomicArb {
    error NotOperator();
    error Reentered();
    error Expired();
    error InvalidAmount();
    error ProfitFloorTooLow();
    error InsufficientPrincipal();
    error UnauthorizedCallback();
    error InvalidSwapDelta();
    error SettlementMismatch();
    error ProfitTooLow(uint256 actual, uint256 required);
    error TransferFailed();

    event Executed(uint256 amountIn, uint256 amountOut, uint256 grossProfit);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    address public immutable operator;

    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant V3_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;

    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant MANGA = 0xc28068cb109Dd0a0d5C6C6a925B048fEA00E31a6;
    address internal constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address internal constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address internal constant HOOK = 0x16D1560630Ce74af4478d9b8AD46548A092A2000;

    address internal constant ENTRY_V3_POOL = 0xeb60bCD1D920ad6E102690CCFC6fB488899E1510;
    address internal constant EXIT_V3_POOL = 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3;

    uint160 internal constant MIN_SQRT_PRICE_PLUS_ONE = 4_295_128_740;
    uint160 internal constant MAX_SQRT_PRICE_MINUS_ONE =
        1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341;

    uint256 public constant MAX_AMOUNT_IN = 15_000_000; // 15 USDG, 6 decimals
    uint256 public constant MIN_GROSS_PROFIT = 50_000; // 0.05 USDG

    uint256 private constant PHASE_UNLOCK = 1;
    uint256 private constant PHASE_ENTRY_CALLBACK = 2;
    uint256 private constant PHASE_EXIT_CALLBACK = 3;
    bytes32 private constant PHASE_SLOT = keccak256("manga.chan.atomic.arb.phase");

    constructor(address operator_, uint256 minimumSeedOut) payable {
        if (operator_ == address(0)) revert NotOperator();
        operator = operator_;

        // A deployment can atomically turn a small amount of native ETH into
        // the executor's reusable USDG float. No approval or follow-up transfer
        // is needed, and a bad seed quote reverts the whole deployment.
        if (msg.value != 0) {
            IUniswapV3SwapRouterMinimal.ExactInputParams memory params =
                IUniswapV3SwapRouterMinimal.ExactInputParams({
                    path: abi.encodePacked(WETH, uint24(100), USDG),
                    recipient: address(this),
                    amountIn: msg.value,
                    amountOutMinimum: minimumSeedOut
                });
            IUniswapV3SwapRouterMinimal(V3_ROUTER).exactInput{value: msg.value}(params);
        } else if (minimumSeedOut != 0) {
            revert InsufficientPrincipal();
        }
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @notice Execute the fixed route. `minProfit` is gross USDG profit;
    /// the off-chain sender additionally enforces net profit after gas.
    function execute(uint128 amountIn, uint128 minProfit, uint48 deadline)
        external
        onlyOperator
        returns (uint256 amountOut, uint256 grossProfit)
    {
        if (_phase() != 0) revert Reentered();
        if (block.timestamp > deadline) revert Expired();
        if (amountIn == 0 || amountIn > MAX_AMOUNT_IN) revert InvalidAmount();
        if (minProfit < MIN_GROSS_PROFIT) revert ProfitFloorTooLow();

        _setPhase(PHASE_UNLOCK);
        bytes memory result = IPoolManagerMinimal(POOL_MANAGER).unlock(abi.encode(amountIn));
        if (_phase() != PHASE_UNLOCK) revert SettlementMismatch();
        _setPhase(0);

        amountOut = abi.decode(result, (uint256));
        if (amountOut < amountIn) revert ProfitTooLow(0, minProfit);
        grossProfit = amountOut - amountIn;
        if (grossProfit < minProfit) revert ProfitTooLow(grossProfit, minProfit);

        emit Executed(amountIn, amountOut, grossProfit);
    }

    /// @dev Called only by the canonical PoolManager while its lock is open.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != POOL_MANAGER || _phase() != PHASE_UNLOCK) revert UnauthorizedCallback();
        uint128 amountIn = abi.decode(data, (uint128));

        // V3 entry sends MSFT straight into PoolManager. sync/settle turns that
        // balance increase into this executor's positive MSFT currency delta.
        IPoolManagerMinimal manager = IPoolManagerMinimal(POOL_MANAGER);
        manager.sync(MSFT);
        _setPhase(PHASE_ENTRY_CALLBACK);
        (int256 entryAmount0, int256 entryAmount1) = IUniswapV3PoolMinimal(ENTRY_V3_POOL).swap(
            POOL_MANAGER,
            true,
            int256(uint256(amountIn)),
            MIN_SQRT_PRICE_PLUS_ONE,
            bytes("")
        );
        _setPhase(PHASE_UNLOCK);
        if (entryAmount0 != int256(uint256(amountIn)) || entryAmount1 >= 0) revert InvalidSwapDelta();
        uint256 msftAmount = uint256(-entryAmount1);
        if (manager.settle() != msftAmount) revert SettlementMismatch();

        // MSFT (currency1) -> MANGA (currency0).
        IPoolManagerMinimal.PoolKey memory msftManga = IPoolManagerMinimal.PoolKey({
            currency0: MANGA,
            currency1: MSFT,
            fee: 10_000,
            tickSpacing: 200,
            hooks: HOOK
        });
        int256 firstDelta = manager.swap(
            msftManga,
            IPoolManagerMinimal.SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(msftAmount),
                sqrtPriceLimitX96: MAX_SQRT_PRICE_MINUS_ONE
            }),
            bytes("")
        );
        int128 firstAmount0 = _amount0(firstDelta);
        int128 firstAmount1 = _amount1(firstDelta);
        if (firstAmount0 <= 0 || firstAmount1 != -int128(int256(msftAmount))) revert InvalidSwapDelta();
        uint256 mangaAmount = uint128(firstAmount0);

        // MANGA (currency0) -> NVDA (currency1).
        IPoolManagerMinimal.PoolKey memory mangaNvda = IPoolManagerMinimal.PoolKey({
            currency0: MANGA,
            currency1: NVDA,
            fee: 10_000,
            tickSpacing: 200,
            hooks: HOOK
        });
        int256 secondDelta = manager.swap(
            mangaNvda,
            IPoolManagerMinimal.SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(mangaAmount),
                sqrtPriceLimitX96: MIN_SQRT_PRICE_PLUS_ONE
            }),
            bytes("")
        );
        int128 secondAmount0 = _amount0(secondDelta);
        int128 secondAmount1 = _amount1(secondDelta);
        if (secondAmount0 != -int128(int256(mangaAmount)) || secondAmount1 <= 0) revert InvalidSwapDelta();
        uint256 nvdaAmount = uint128(secondAmount1);

        // V3 exit pays its NVDA input directly from PoolManager in the swap
        // callback. `take` consumes the positive NVDA currency delta, so the
        // PoolManager unlock finishes with every currency delta exactly zero.
        _setPhase(PHASE_EXIT_CALLBACK);
        (int256 exitAmount0, int256 exitAmount1) = IUniswapV3PoolMinimal(EXIT_V3_POOL).swap(
            address(this),
            false,
            int256(nvdaAmount),
            MAX_SQRT_PRICE_MINUS_ONE,
            bytes("")
        );
        _setPhase(PHASE_UNLOCK);
        if (exitAmount0 >= 0 || exitAmount1 != int256(nvdaAmount)) revert InvalidSwapDelta();

        return abi.encode(uint256(-exitAmount0));
    }

    /// @dev Exact V3 pools and transient phase together prevent an arbitrary
    /// caller from making this contract pay a forged callback.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        uint256 phase = _phase();
        if (phase == PHASE_ENTRY_CALLBACK) {
            if (msg.sender != ENTRY_V3_POOL || amount0Delta <= 0 || amount1Delta >= 0) {
                revert UnauthorizedCallback();
            }
            _safeTransfer(USDG, ENTRY_V3_POOL, uint256(amount0Delta));
            return;
        }

        if (phase == PHASE_EXIT_CALLBACK) {
            if (msg.sender != EXIT_V3_POOL || amount0Delta >= 0 || amount1Delta <= 0) {
                revert UnauthorizedCallback();
            }
            IPoolManagerMinimal(POOL_MANAGER).take(NVDA, EXIT_V3_POOL, uint256(amount1Delta));
            return;
        }

        revert UnauthorizedCallback();
    }

    function withdraw(address token, uint256 amount, address to) external onlyOperator {
        if (to == address(0)) revert TransferFailed();
        _safeTransfer(token, to, amount);
        emit Withdrawn(token, to, amount);
    }

    function _amount0(int256 delta) private pure returns (int128) {
        return int128(delta >> 128);
    }

    function _amount1(int256 delta) private pure returns (int128) {
        return int128(delta);
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool success, bytes memory result) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) revert TransferFailed();
    }

    function _phase() private view returns (uint256 phase) {
        bytes32 slot = PHASE_SLOT;
        assembly ("memory-safe") {
            phase := tload(slot)
        }
    }

    function _setPhase(uint256 phase) private {
        bytes32 slot = PHASE_SLOT;
        assembly ("memory-safe") {
            tstore(slot, phase)
        }
    }
}
