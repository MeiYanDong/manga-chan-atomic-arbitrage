// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20GenericMinimal {
    function balanceOf(address account) external view returns (uint256);
}

interface IUniswapV3PoolGenericMinimal {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

interface IUniswapV3FactoryGenericMinimal {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3RouterGenericMinimal {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

interface IPoolManagerGenericMinimal {
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

/// @title Bounded generic PAIR atomic-arbitrage executor
/// @notice Executes one operator-selected cycle:
/// USDG -(V3, zero to two hops)-> entry quote -(PAIR V4)-> target
///      -(PAIR V4)-> exit quote -(V3, zero to two hops)-> USDG.
/// The only external execution targets are the canonical V3 router/factory and
/// PoolManager. PAIR's hook, fee and tick spacing remain fixed invariants.
contract GenericAtomicArb {
    error NotOperator();
    error Reentered();
    error Expired();
    error InvalidAmount();
    error ProfitFloorTooLow();
    error InsufficientPrincipal();
    error UnauthorizedCallback();
    error InvalidRoute();
    error InvalidV3Path();
    error MissingV3Pool();
    error InvalidV4Pool();
    error DuplicateV4Pool();
    error InvalidSwapDelta();
    error SettlementMismatch();
    error ProfitTooLow(uint256 actual, uint256 required);
    error TokenCallFailed();

    event Executed(
        bytes32 indexed routeHash,
        address indexed targetToken,
        uint256 amountIn,
        uint256 amountOut,
        uint256 grossProfit
    );
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    struct Route {
        address targetToken;
        address entryToken;
        address exitToken;
        bytes entryV3Path;
        bytes exitV3Path;
        IPoolManagerGenericMinimal.PoolKey entryV4Pool;
        IPoolManagerGenericMinimal.PoolKey exitV4Pool;
    }

    address public immutable operator;

    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant V3_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address internal constant PAIR_HOOK = 0x16D1560630Ce74af4478d9b8AD46548A092A2000;

    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    uint24 internal constant PAIR_FEE = 10_000;
    int24 internal constant PAIR_TICK_SPACING = 200;
    uint256 internal constant MAX_V3_HOPS = 2;
    uint160 internal constant MIN_SQRT_PRICE_PLUS_ONE = 4_295_128_740;
    uint160 internal constant MAX_SQRT_PRICE_MINUS_ONE =
        1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341;

    uint256 public constant MAX_AMOUNT_IN = 100_000_000; // 100 USDG, 6 decimals
    uint256 public constant MIN_GROSS_PROFIT = 50_000; // 0.05 USDG

    uint256 private constant PHASE_UNLOCK = 1;
    uint256 private constant PHASE_ENTRY_DIRECT = 2;
    uint256 private constant PHASE_EXIT_DIRECT = 3;
    bytes32 private constant PHASE_SLOT = keccak256("generic.arb.phase.v1");
    bytes32 private constant EXPECTED_POOL_SLOT = keccak256("generic.arb.pool.v1");
    bytes32 private constant EXPECTED_TOKEN_SLOT = keccak256("generic.arb.token.v1");
    bytes32 private constant EXPECTED_AMOUNT_SLOT = keccak256("generic.arb.amount.v1");
    bytes32 private constant INPUT_TOKEN0_SLOT = keccak256("generic.arb.token0.v1");

    constructor(address operator_, uint256 minimumSeedOut) payable {
        if (operator_ == address(0)) revert NotOperator();
        operator = operator_;

        if (msg.value != 0) {
            IUniswapV3RouterGenericMinimal.ExactInputParams memory params =
                IUniswapV3RouterGenericMinimal.ExactInputParams({
                    path: abi.encodePacked(WETH, uint24(100), USDG),
                    recipient: address(this),
                    amountIn: msg.value,
                    amountOutMinimum: minimumSeedOut
                });
            IUniswapV3RouterGenericMinimal(V3_ROUTER).exactInput{value: msg.value}(params);
        } else if (minimumSeedOut != 0) {
            revert InsufficientPrincipal();
        }
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @notice Executes a typed, bounded route. `minProfit` is gross USDG
    /// profit; the sender must separately enforce a net floor after gas.
    function execute(Route calldata route, uint128 amountIn, uint128 minProfit, uint48 deadline)
        external
        onlyOperator
        returns (uint256 amountOut, uint256 grossProfit)
    {
        if (_phase() != 0) revert Reentered();
        if (block.timestamp > deadline) revert Expired();
        if (amountIn == 0 || amountIn > MAX_AMOUNT_IN) revert InvalidAmount();
        if (minProfit < MIN_GROSS_PROFIT) revert ProfitFloorTooLow();
        _validateRoute(route);

        uint256 balanceBefore = IERC20GenericMinimal(USDG).balanceOf(address(this));
        if (balanceBefore < amountIn) revert InsufficientPrincipal();
        bytes32 selectedRouteHash = keccak256(abi.encode(route));

        _setPhase(PHASE_UNLOCK);
        bytes memory result = IPoolManagerGenericMinimal(POOL_MANAGER).unlock(abi.encode(route, amountIn));
        if (_phase() != PHASE_UNLOCK) revert SettlementMismatch();
        _setPhase(0);

        uint256 reportedOut = abi.decode(result, (uint256));
        uint256 balanceAfter = IERC20GenericMinimal(USDG).balanceOf(address(this));
        if (balanceAfter < balanceBefore) revert ProfitTooLow(0, minProfit);
        grossProfit = balanceAfter - balanceBefore;
        amountOut = uint256(amountIn) + grossProfit;
        if (reportedOut != amountOut) revert SettlementMismatch();
        if (grossProfit < minProfit) revert ProfitTooLow(grossProfit, minProfit);

        emit Executed(selectedRouteHash, route.targetToken, amountIn, amountOut, grossProfit);
    }

    /// @dev Only the canonical PoolManager can enter this callback while an
    /// operator-authorized execution is active.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != POOL_MANAGER || _phase() != PHASE_UNLOCK) revert UnauthorizedCallback();
        (Route memory route, uint128 amountIn) = abi.decode(data, (Route, uint128));
        IPoolManagerGenericMinimal manager = IPoolManagerGenericMinimal(POOL_MANAGER);

        uint256 entryAmount;
        manager.sync(route.entryToken);
        if (route.entryToken == USDG) {
            _safeTransfer(USDG, POOL_MANAGER, amountIn);
            entryAmount = manager.settle();
        } else if (route.entryV3Path.length == 43) {
            (address entryPool, bool zeroForOne) = _directV3Pool(route.entryV3Path);
            _setDirectContext(PHASE_ENTRY_DIRECT, entryPool, USDG, amountIn, zeroForOne);
            (int256 amount0, int256 amount1) = IUniswapV3PoolGenericMinimal(entryPool).swap(
                POOL_MANAGER,
                zeroForOne,
                int256(uint256(amountIn)),
                zeroForOne ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE,
                bytes("")
            );
            _clearDirectContext();
            entryAmount = _validateV3ExactInputDelta(amount0, amount1, zeroForOne, amountIn);
            if (manager.settle() != entryAmount) revert SettlementMismatch();
        } else {
            _forceApprove(USDG, V3_ROUTER, amountIn);
            entryAmount = IUniswapV3RouterGenericMinimal(V3_ROUTER).exactInput(
                IUniswapV3RouterGenericMinimal.ExactInputParams({
                    path: route.entryV3Path,
                    recipient: POOL_MANAGER,
                    amountIn: amountIn,
                    amountOutMinimum: 1
                })
            );
            if (manager.settle() != entryAmount) revert SettlementMismatch();
        }
        if (entryAmount == 0 || entryAmount > uint256(uint128(type(int128).max))) revert InvalidSwapDelta();

        bool entryZeroForOne = route.entryV4Pool.currency0 == route.entryToken;
        int256 firstDelta = manager.swap(
            route.entryV4Pool,
            IPoolManagerGenericMinimal.SwapParams({
                zeroForOne: entryZeroForOne,
                amountSpecified: -int256(entryAmount),
                sqrtPriceLimitX96: entryZeroForOne ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE
            }),
            bytes("")
        );
        uint256 targetAmount = _validateExactInputDelta(firstDelta, entryZeroForOne, entryAmount);

        bool exitZeroForOne = route.exitV4Pool.currency0 == route.targetToken;
        int256 secondDelta = manager.swap(
            route.exitV4Pool,
            IPoolManagerGenericMinimal.SwapParams({
                zeroForOne: exitZeroForOne,
                amountSpecified: -int256(targetAmount),
                sqrtPriceLimitX96: exitZeroForOne ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE
            }),
            bytes("")
        );
        uint256 exitAmount = _validateExactInputDelta(secondDelta, exitZeroForOne, targetAmount);

        uint256 output;
        if (route.exitToken == USDG) {
            manager.take(USDG, address(this), exitAmount);
            output = exitAmount;
        } else if (route.exitV3Path.length == 43) {
            (address exitPool, bool zeroForOne) = _directV3Pool(route.exitV3Path);
            _setDirectContext(PHASE_EXIT_DIRECT, exitPool, route.exitToken, exitAmount, zeroForOne);
            (int256 amount0, int256 amount1) = IUniswapV3PoolGenericMinimal(exitPool).swap(
                address(this),
                zeroForOne,
                int256(exitAmount),
                zeroForOne ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE,
                bytes("")
            );
            _clearDirectContext();
            output = _validateV3ExactInputDelta(amount0, amount1, zeroForOne, exitAmount);
        } else {
            manager.take(route.exitToken, address(this), exitAmount);
            _forceApprove(route.exitToken, V3_ROUTER, exitAmount);
            output = IUniswapV3RouterGenericMinimal(V3_ROUTER).exactInput(
                IUniswapV3RouterGenericMinimal.ExactInputParams({
                    path: route.exitV3Path,
                    recipient: address(this),
                    amountIn: exitAmount,
                    amountOutMinimum: 1
                })
            );
        }
        return abi.encode(output);
    }

    /// @dev One-hop V3 anchors bypass the router. Transient pool/token/amount
    /// bindings prevent an arbitrary token callback from forging payment.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        uint256 phase = _phase();
        if (phase != PHASE_ENTRY_DIRECT && phase != PHASE_EXIT_DIRECT) revert UnauthorizedCallback();
        if (msg.sender != _expectedPool()) revert UnauthorizedCallback();
        bool inputToken0 = _inputToken0();
        int256 inputDelta = inputToken0 ? amount0Delta : amount1Delta;
        int256 outputDelta = inputToken0 ? amount1Delta : amount0Delta;
        if (inputDelta <= 0 || outputDelta >= 0 || uint256(inputDelta) != _expectedAmount()) {
            revert InvalidSwapDelta();
        }
        if (phase == PHASE_ENTRY_DIRECT) {
            _safeTransfer(USDG, msg.sender, uint256(inputDelta));
        } else {
            IPoolManagerGenericMinimal(POOL_MANAGER).take(_expectedToken(), msg.sender, uint256(inputDelta));
        }
    }

    function withdraw(address token, uint256 amount, address to) external onlyOperator {
        if (to == address(0)) revert TokenCallFailed();
        _safeTransfer(token, to, amount);
        emit Withdrawn(token, to, amount);
    }

    function routeHash(Route calldata route) external pure returns (bytes32) {
        return keccak256(abi.encode(route));
    }

    function _validateRoute(Route calldata route) private view {
        if (
            route.targetToken == address(0) || route.entryToken == address(0) || route.exitToken == address(0)
                || route.targetToken == USDG || route.targetToken == route.entryToken
                || route.targetToken == route.exitToken
        ) revert InvalidRoute();

        _validateV4Pool(route.entryV4Pool, route.targetToken, route.entryToken);
        _validateV4Pool(route.exitV4Pool, route.targetToken, route.exitToken);
        if (keccak256(abi.encode(route.entryV4Pool)) == keccak256(abi.encode(route.exitV4Pool))) {
            revert DuplicateV4Pool();
        }
        _validateV3Path(route.entryV3Path, USDG, route.entryToken);
        _validateV3Path(route.exitV3Path, route.exitToken, USDG);
    }

    function _validateV4Pool(IPoolManagerGenericMinimal.PoolKey calldata key, address target, address quote)
        private
        pure
    {
        if (
            key.currency0 == address(0) || key.currency0 >= key.currency1 || key.fee != PAIR_FEE
                || key.tickSpacing != PAIR_TICK_SPACING || key.hooks != PAIR_HOOK
        ) revert InvalidV4Pool();
        bool tokensMatch = (key.currency0 == target && key.currency1 == quote)
            || (key.currency0 == quote && key.currency1 == target);
        if (!tokensMatch) revert InvalidV4Pool();
    }

    function _validateV3Path(bytes calldata path, address expectedStart, address expectedEnd) private view {
        if (expectedStart == expectedEnd) {
            if (path.length != 0) revert InvalidV3Path();
            return;
        }
        if (path.length < 43 || path.length > 20 + 23 * MAX_V3_HOPS || (path.length - 20) % 23 != 0) {
            revert InvalidV3Path();
        }
        uint256 hops = (path.length - 20) / 23;
        address token = _pathAddress(path, 0);
        if (token != expectedStart || _pathAddress(path, path.length - 20) != expectedEnd) revert InvalidV3Path();
        for (uint256 index = 0; index < hops; ++index) {
            uint256 cursor = index * 23;
            uint24 fee = _pathFee(path, cursor + 20);
            address nextToken = _pathAddress(path, cursor + 23);
            if (!_allowedV3Fee(fee) || nextToken == address(0) || nextToken == token) revert InvalidV3Path();
            if (hops == 2 && index == 0 && nextToken != WETH) revert InvalidV3Path();
            if (IUniswapV3FactoryGenericMinimal(V3_FACTORY).getPool(token, nextToken, fee) == address(0)) {
                revert MissingV3Pool();
            }
            token = nextToken;
        }
    }

    function _allowedV3Fee(uint24 fee) private pure returns (bool) {
        return fee == 100 || fee == 500 || fee == 3_000 || fee == 10_000;
    }

    function _validateExactInputDelta(int256 delta, bool zeroForOne, uint256 expectedInput)
        private
        pure
        returns (uint256 output)
    {
        int128 amount0 = int128(delta >> 128);
        int128 amount1 = int128(delta);
        int128 inputDelta = zeroForOne ? amount0 : amount1;
        int128 outputDelta = zeroForOne ? amount1 : amount0;
        if (inputDelta >= 0 || outputDelta <= 0 || uint128(-inputDelta) != expectedInput) revert InvalidSwapDelta();
        output = uint128(outputDelta);
    }

    function _validateV3ExactInputDelta(int256 amount0, int256 amount1, bool zeroForOne, uint256 expectedInput)
        private
        pure
        returns (uint256 output)
    {
        int256 inputDelta = zeroForOne ? amount0 : amount1;
        int256 outputDelta = zeroForOne ? amount1 : amount0;
        if (inputDelta <= 0 || outputDelta >= 0 || uint256(inputDelta) != expectedInput) revert InvalidSwapDelta();
        output = uint256(-outputDelta);
    }

    function _directV3Pool(bytes memory path) private view returns (address pool, bool zeroForOne) {
        address tokenIn = _memoryPathAddress(path, 0);
        uint24 fee = _memoryPathFee(path, 20);
        address tokenOut = _memoryPathAddress(path, 23);
        pool = IUniswapV3FactoryGenericMinimal(V3_FACTORY).getPool(tokenIn, tokenOut, fee);
        if (pool == address(0)) revert MissingV3Pool();
        zeroForOne = tokenIn < tokenOut;
    }

    function _pathAddress(bytes calldata path, uint256 offset) private pure returns (address token) {
        assembly ("memory-safe") {
            token := shr(96, calldataload(add(path.offset, offset)))
        }
    }

    function _pathFee(bytes calldata path, uint256 offset) private pure returns (uint24 fee) {
        assembly ("memory-safe") {
            fee := shr(232, calldataload(add(path.offset, offset)))
        }
    }

    function _memoryPathAddress(bytes memory path, uint256 offset) private pure returns (address token) {
        assembly ("memory-safe") {
            token := shr(96, mload(add(add(path, 32), offset)))
        }
    }

    function _memoryPathFee(bytes memory path, uint256 offset) private pure returns (uint24 fee) {
        assembly ("memory-safe") {
            fee := shr(232, mload(add(add(path, 32), offset)))
        }
    }

    function _forceApprove(address token, address spender, uint256 amount) private {
        if (_callOptionalReturn(token, abi.encodeWithSelector(0x095ea7b3, spender, amount))) return;
        if (!_callOptionalReturn(token, abi.encodeWithSelector(0x095ea7b3, spender, 0))) revert TokenCallFailed();
        if (!_callOptionalReturn(token, abi.encodeWithSelector(0x095ea7b3, spender, amount))) revert TokenCallFailed();
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        if (!_callOptionalReturn(token, abi.encodeWithSelector(0xa9059cbb, to, amount))) revert TokenCallFailed();
    }

    function _callOptionalReturn(address token, bytes memory data) private returns (bool) {
        (bool success, bytes memory result) = token.call(data);
        return success && (result.length == 0 || (result.length == 32 && abi.decode(result, (bool))));
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

    function _setDirectContext(uint256 phase, address pool, address token, uint256 amount, bool inputToken0)
        private
    {
        bytes32 poolSlot = EXPECTED_POOL_SLOT;
        bytes32 tokenSlot = EXPECTED_TOKEN_SLOT;
        bytes32 amountSlot = EXPECTED_AMOUNT_SLOT;
        bytes32 token0Slot = INPUT_TOKEN0_SLOT;
        assembly ("memory-safe") {
            tstore(poolSlot, pool)
            tstore(tokenSlot, token)
            tstore(amountSlot, amount)
            tstore(token0Slot, inputToken0)
        }
        _setPhase(phase);
    }

    function _clearDirectContext() private {
        bytes32 poolSlot = EXPECTED_POOL_SLOT;
        bytes32 tokenSlot = EXPECTED_TOKEN_SLOT;
        bytes32 amountSlot = EXPECTED_AMOUNT_SLOT;
        bytes32 token0Slot = INPUT_TOKEN0_SLOT;
        assembly ("memory-safe") {
            tstore(poolSlot, 0)
            tstore(tokenSlot, 0)
            tstore(amountSlot, 0)
            tstore(token0Slot, 0)
        }
        _setPhase(PHASE_UNLOCK);
    }

    function _expectedPool() private view returns (address pool) {
        bytes32 slot = EXPECTED_POOL_SLOT;
        assembly ("memory-safe") {
            pool := tload(slot)
        }
    }

    function _expectedToken() private view returns (address token) {
        bytes32 slot = EXPECTED_TOKEN_SLOT;
        assembly ("memory-safe") {
            token := tload(slot)
        }
    }

    function _expectedAmount() private view returns (uint256 amount) {
        bytes32 slot = EXPECTED_AMOUNT_SLOT;
        assembly ("memory-safe") {
            amount := tload(slot)
        }
    }

    function _inputToken0() private view returns (bool inputToken0) {
        bytes32 slot = INPUT_TOKEN0_SLOT;
        assembly ("memory-safe") {
            inputToken0 := tload(slot)
        }
    }
}
