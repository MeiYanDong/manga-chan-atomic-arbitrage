// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20UniversalMinimal {
    function balanceOf(address account) external view returns (uint256);
}

interface IMorphoUniversalMinimal {
    function flashLoan(address token, uint256 assets, bytes calldata data) external;
}

interface IUniswapV2FactoryUniversalMinimal {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IUniswapV2PairUniversalMinimal {
    function token0() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 timestampLast);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface IUniswapV3FactoryUniversalMinimal {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3PoolUniversalMinimal {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

interface IPoolManagerUniversalMinimal {
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

interface IEarnVaultUniversalMinimal {
    function isPoolInitialized(address pool) external view returns (bool);
    function isPoolPaused(address pool) external view returns (bool);
    function isPoolInRecoveryMode(address pool) external view returns (bool);
    function getPoolTokens(address pool) external view returns (address[] memory tokens);
}

interface IEarnRouterUniversalMinimal {
    function swapSingleTokenExactIn(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 exactAmountIn,
        uint256 minAmountOut,
        uint256 deadline,
        bool wethIsEth,
        bytes calldata userData
    ) external payable returns (uint256 amountOut);

    function addLiquidityUnbalanced(
        address pool,
        uint256[] memory exactAmountsIn,
        uint256 minBptAmountOut,
        bool wethIsEth,
        bytes memory userData
    ) external payable returns (uint256 bptAmountOut);

    function removeLiquidityProportional(
        address pool,
        uint256 exactBptAmountIn,
        uint256[] memory minAmountsOut,
        bool wethIsEth,
        bytes memory userData
    ) external payable returns (uint256[] memory amountsOut);
}

interface IPermit2UniversalMinimal {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @title Typed cross-protocol atomic-arbitrage executor for Robinhood Chain
/// @notice Runs a bounded list of canonical Uniswap and Earn actions using
/// either protected contract inventory or a zero-fee Morpho flash loan.
/// There is deliberately no arbitrary-call action: route freedom lives in the
/// typed graph, while every external target and callback remains constrained.
contract UniversalAtomicExecutor {
    error NotOperator();
    error Reentered();
    error Expired();
    error InvalidPlan();
    error InvalidAction();
    error InvalidAmount();
    error InsufficientPrincipal();
    error UnauthorizedCallback();
    error CanonicalPoolMismatch();
    error InvalidSwapDelta();
    error SettlementMismatch();
    error ProfitTooLow(uint256 actual, uint256 required);
    error TokenCallFailed();
    error QuoteResult(int256 settlementDelta);

    event Executed(
        bytes32 indexed planHash,
        address indexed settlementToken,
        uint256 principal,
        uint256 grossProfit,
        bool flashFunded
    );
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    enum ActionKind {
        UNISWAP_V2_SWAP,
        UNISWAP_V3_SWAP,
        UNISWAP_V4_SWAP,
        EARN_SWAP,
        EARN_ADD_UNBALANCED,
        EARN_REMOVE_PROPORTIONAL
    }

    struct TrackedToken {
        address token;
        uint256 maximumResidual;
    }

    struct Action {
        ActionKind kind;
        address tokenIn;
        address tokenOut;
        address pool;
        uint256 amountIn;
        uint256 minimumAmountOut;
        uint24 fee;
        IPoolManagerUniversalMinimal.PoolKey v4Pool;
    }

    struct Plan {
        address settlementToken;
        TrackedToken[] trackedTokens;
        Action[] actions;
        uint256 minimumProfit;
        uint48 deadline;
    }

    address public immutable operator;

    address public constant MORPHO = 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010;
    address public constant UNISWAP_V2_FACTORY = 0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f;
    address public constant UNISWAP_V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address public constant UNISWAP_V4_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address public constant EARN_VAULT = 0x28082618Ba2073E602230188E4F4C46e9b2169EB;
    address public constant EARN_ROUTER = 0xFCcDd6Df64de63b609042c55C629F223321340e1;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint256 public constant MAX_TRACKED_TOKENS = 16;
    uint256 public constant MAX_ACTIONS = 24;
    uint256 private constant V2_FEE_NUMERATOR = 997;
    uint256 private constant V2_FEE_DENOMINATOR = 1_000;
    uint160 private constant MIN_SQRT_PRICE_PLUS_ONE = 4_295_128_740;
    uint160 private constant MAX_SQRT_PRICE_MINUS_ONE =
        1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341;
    bytes32 private constant PHASE_SLOT = keccak256("universal.atomic.phase.v1");
    bytes32 private constant V3_POOL_SLOT = keccak256("universal.atomic.v3.pool.v1");
    bytes32 private constant V3_TOKEN_SLOT = keccak256("universal.atomic.v3.token.v1");
    bytes32 private constant V3_AMOUNT_SLOT = keccak256("universal.atomic.v3.amount.v1");
    bytes32 private constant V3_TOKEN0_SLOT = keccak256("universal.atomic.v3.token0.v1");

    uint256 private constant PHASE_INVENTORY = 1;
    uint256 private constant PHASE_FLASH = 2;
    uint256 private constant PHASE_QUOTE = 3;
    uint256 private constant PHASE_V4_UNLOCK = 4;

    constructor(address operator_) {
        if (operator_ == address(0)) revert NotOperator();
        operator = operator_;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @notice Execute with an explicitly bounded part of existing settlement
    /// inventory. Existing balances of every other tracked token are protected.
    function executeWithInventory(Plan calldata plan, uint256 principal)
        external
        onlyOperator
        returns (uint256 grossProfit)
    {
        if (_phase() != 0) revert Reentered();
        _validatePlan(plan);
        uint256[] memory baselines = _snapshotBaselines(plan, principal);
        _setPhase(PHASE_INVENTORY);
        _runActions(plan, baselines);
        grossProfit = _finish(plan, baselines, principal);
        _setPhase(0);
        emit Executed(keccak256(abi.encode(plan)), plan.settlementToken, principal, grossProfit, false);
    }

    /// @notice Execute with a zero-fee Morpho flash loan. Morpho receives only
    /// an exact temporary approval and pulls the exact principal after callback.
    function executeWithFlash(Plan calldata plan, uint256 principal)
        external
        onlyOperator
        returns (uint256 grossProfit)
    {
        if (_phase() != 0) revert Reentered();
        _validatePlan(plan);
        if (principal == 0) revert InvalidAmount();
        uint256 balanceBefore = IERC20UniversalMinimal(plan.settlementToken).balanceOf(address(this));
        uint256[] memory baselines = _snapshotBaselines(plan, 0);
        _setPhase(PHASE_FLASH);
        IMorphoUniversalMinimal(MORPHO).flashLoan(
            plan.settlementToken, principal, abi.encode(plan, baselines, principal, false)
        );
        _forceApprove(plan.settlementToken, MORPHO, 0);
        _setPhase(0);
        uint256 balanceAfter = IERC20UniversalMinimal(plan.settlementToken).balanceOf(address(this));
        if (balanceAfter < balanceBefore) revert ProfitTooLow(0, plan.minimumProfit);
        grossProfit = balanceAfter - balanceBefore;
        if (grossProfit < plan.minimumProfit) revert ProfitTooLow(grossProfit, plan.minimumProfit);
        emit Executed(keccak256(abi.encode(plan)), plan.settlementToken, principal, grossProfit, true);
    }

    /// @notice Full-state quote using the exact flash-funded action path. The
    /// call always reverts with QuoteResult, so it can never mutate chain state.
    function quoteWithFlash(Plan calldata plan, uint256 principal) external {
        if (_phase() != 0) revert Reentered();
        _validatePlan(plan);
        if (principal == 0) revert InvalidAmount();
        uint256[] memory baselines = _snapshotBaselines(plan, 0);
        _setPhase(PHASE_QUOTE);
        IMorphoUniversalMinimal(MORPHO).flashLoan(
            plan.settlementToken, principal, abi.encode(plan, baselines, principal, true)
        );
        revert SettlementMismatch();
    }

    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external {
        uint256 phase = _phase();
        if (msg.sender != MORPHO || (phase != PHASE_FLASH && phase != PHASE_QUOTE)) revert UnauthorizedCallback();
        (Plan memory plan, uint256[] memory baselines, uint256 expectedAssets, bool quote) =
            abi.decode(data, (Plan, uint256[], uint256, bool));
        if (assets != expectedAssets || quote != (phase == PHASE_QUOTE)) revert UnauthorizedCallback();
        _runActions(plan, baselines);
        _validateResiduals(plan, baselines);
        uint256 current = IERC20UniversalMinimal(plan.settlementToken).balanceOf(address(this));
        uint256 required = _baselineFor(plan, baselines, plan.settlementToken) + assets;
        if (quote) {
            if (current >= required) revert QuoteResult(_toSigned(current - required));
            revert QuoteResult(-_toSigned(required - current));
        }
        if (current < required + plan.minimumProfit) {
            revert ProfitTooLow(current > required ? current - required : 0, plan.minimumProfit);
        }
        _forceApprove(plan.settlementToken, MORPHO, assets);
    }

    /// @dev PoolManager callback is entered only while a typed V4 action has
    /// temporarily switched the phase from the enclosing inventory/flash run.
    function unlockCallback(bytes calldata data) external returns (bytes memory result) {
        if (msg.sender != UNISWAP_V4_POOL_MANAGER || _phase() != PHASE_V4_UNLOCK) {
            revert UnauthorizedCallback();
        }
        (Action memory action, uint256 amountIn, uint256 outerPhase) = abi.decode(data, (Action, uint256, uint256));
        if (outerPhase != PHASE_INVENTORY && outerPhase != PHASE_FLASH && outerPhase != PHASE_QUOTE) {
            revert UnauthorizedCallback();
        }
        IPoolManagerUniversalMinimal manager = IPoolManagerUniversalMinimal(UNISWAP_V4_POOL_MANAGER);
        manager.sync(action.tokenIn);
        _safeTransfer(action.tokenIn, UNISWAP_V4_POOL_MANAGER, amountIn);
        if (manager.settle() != amountIn) revert SettlementMismatch();
        bool zeroForOne = action.v4Pool.currency0 == action.tokenIn;
        int256 delta = manager.swap(
            action.v4Pool,
            IPoolManagerUniversalMinimal.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE
            }),
            bytes("")
        );
        uint256 amountOut = _validateV4Delta(delta, zeroForOne, amountIn);
        manager.take(action.tokenOut, address(this), amountOut);
        _setPhase(outerPhase);
        return abi.encode(amountOut);
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        address pool = _v3Pool();
        if (pool == address(0) || msg.sender != pool) revert UnauthorizedCallback();
        bool token0In = _v3Token0();
        int256 inputDelta = token0In ? amount0Delta : amount1Delta;
        int256 outputDelta = token0In ? amount1Delta : amount0Delta;
        if (inputDelta <= 0 || outputDelta >= 0 || uint256(inputDelta) != _v3Amount()) {
            revert InvalidSwapDelta();
        }
        _safeTransfer(_v3Token(), msg.sender, uint256(inputDelta));
    }

    function withdraw(address token, uint256 amount, address to) external onlyOperator {
        if (_phase() != 0 || to == address(0)) revert Reentered();
        _safeTransfer(token, to, amount);
        emit Withdrawn(token, to, amount);
    }

    function planHash(Plan calldata plan) external pure returns (bytes32) {
        return keccak256(abi.encode(plan));
    }

    function _runActions(Plan memory plan, uint256[] memory baselines) private {
        for (uint256 index = 0; index < plan.actions.length; ++index) {
            Action memory action = plan.actions[index];
            uint256 amountIn = action.kind == ActionKind.EARN_ADD_UNBALANCED
                ? 0
                : _availableAmount(plan, baselines, action.tokenIn, action.amountIn);
            uint256 beforeOut = action.tokenOut == address(0)
                ? 0
                : IERC20UniversalMinimal(action.tokenOut).balanceOf(address(this));
            uint256 amountOut;
            if (action.kind == ActionKind.UNISWAP_V2_SWAP) amountOut = _swapV2(action, amountIn);
            else if (action.kind == ActionKind.UNISWAP_V3_SWAP) amountOut = _swapV3(action, amountIn);
            else if (action.kind == ActionKind.UNISWAP_V4_SWAP) amountOut = _swapV4(action, amountIn);
            else if (action.kind == ActionKind.EARN_SWAP) amountOut = _swapEarn(action, amountIn, plan.deadline);
            else if (action.kind == ActionKind.EARN_ADD_UNBALANCED) amountOut = _addEarn(plan, baselines, action);
            else if (action.kind == ActionKind.EARN_REMOVE_PROPORTIONAL) {
                amountOut = _removeEarn(plan, action, amountIn);
            } else revert InvalidAction();

            if (action.tokenOut != address(0)) {
                uint256 afterOut = IERC20UniversalMinimal(action.tokenOut).balanceOf(address(this));
                if (afterOut < beforeOut || afterOut - beforeOut != amountOut || amountOut < action.minimumAmountOut) {
                    revert SettlementMismatch();
                }
            }
        }
    }

    function _swapV2(Action memory action, uint256 amountIn) private returns (uint256 amountOut) {
        if (action.fee != 0 || action.pool == address(0)) revert InvalidAction();
        if (IUniswapV2FactoryUniversalMinimal(UNISWAP_V2_FACTORY).getPair(action.tokenIn, action.tokenOut) != action.pool) {
            revert CanonicalPoolMismatch();
        }
        IUniswapV2PairUniversalMinimal pair = IUniswapV2PairUniversalMinimal(action.pool);
        bool zeroForOne = pair.token0() == action.tokenIn;
        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();
        uint256 reserveIn = zeroForOne ? reserve0 : reserve1;
        uint256 reserveOut = zeroForOne ? reserve1 : reserve0;
        uint256 amountInWithFee = amountIn * V2_FEE_NUMERATOR;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * V2_FEE_DENOMINATOR + amountInWithFee);
        if (amountOut == 0) revert InvalidSwapDelta();
        _safeTransfer(action.tokenIn, action.pool, amountIn);
        pair.swap(zeroForOne ? 0 : amountOut, zeroForOne ? amountOut : 0, address(this), bytes(""));
    }

    function _swapV3(Action memory action, uint256 amountIn) private returns (uint256 amountOut) {
        if (action.pool == address(0) || action.fee == 0) revert InvalidAction();
        if (
            IUniswapV3FactoryUniversalMinimal(UNISWAP_V3_FACTORY).getPool(action.tokenIn, action.tokenOut, action.fee)
                != action.pool
        ) revert CanonicalPoolMismatch();
        bool zeroForOne = action.tokenIn < action.tokenOut;
        _setV3Context(action.pool, action.tokenIn, amountIn, zeroForOne);
        (int256 amount0, int256 amount1) = IUniswapV3PoolUniversalMinimal(action.pool).swap(
            address(this),
            zeroForOne,
            int256(amountIn),
            zeroForOne ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE,
            bytes("")
        );
        _clearV3Context();
        int256 inputDelta = zeroForOne ? amount0 : amount1;
        int256 outputDelta = zeroForOne ? amount1 : amount0;
        if (inputDelta <= 0 || outputDelta >= 0 || uint256(inputDelta) != amountIn) revert InvalidSwapDelta();
        amountOut = uint256(-outputDelta);
    }

    function _swapV4(Action memory action, uint256 amountIn) private returns (uint256 amountOut) {
        if (
            action.pool != address(0) || action.fee != 0 || action.v4Pool.currency0 >= action.v4Pool.currency1
                || !((action.v4Pool.currency0 == action.tokenIn && action.v4Pool.currency1 == action.tokenOut)
                    || (action.v4Pool.currency1 == action.tokenIn && action.v4Pool.currency0 == action.tokenOut))
        ) revert InvalidAction();
        uint256 outerPhase = _phase();
        _setPhase(PHASE_V4_UNLOCK);
        bytes memory result = IPoolManagerUniversalMinimal(UNISWAP_V4_POOL_MANAGER).unlock(
            abi.encode(action, amountIn, outerPhase)
        );
        if (_phase() != outerPhase) revert SettlementMismatch();
        amountOut = abi.decode(result, (uint256));
    }

    function _swapEarn(Action memory action, uint256 amountIn, uint48 deadline) private returns (uint256 amountOut) {
        if (action.pool == address(0) || action.fee != 0) revert InvalidAction();
        _validateEarnPool(action.pool, action.tokenIn, action.tokenOut);
        _approvePermit2(action.tokenIn, amountIn);
        amountOut = IEarnRouterUniversalMinimal(EARN_ROUTER).swapSingleTokenExactIn(
            action.pool,
            action.tokenIn,
            action.tokenOut,
            amountIn,
            action.minimumAmountOut,
            deadline,
            false,
            bytes("")
        );
        _revokePermit2(action.tokenIn);
    }

    function _addEarn(Plan memory plan, uint256[] memory baselines, Action memory action)
        private
        returns (uint256 bptAmountOut)
    {
        if (
            action.pool == address(0) || action.pool != action.tokenOut || action.tokenIn != address(0)
                || action.amountIn != 0 || action.fee != 0
        ) revert InvalidAction();
        address[] memory tokens = _earnPoolTokens(action.pool);
        uint256[] memory amounts = new uint256[](tokens.length);
        for (uint256 index = 0; index < tokens.length; ++index) {
            amounts[index] = _availableAmount(plan, baselines, tokens[index], 0);
            _approvePermit2(tokens[index], amounts[index]);
        }
        bptAmountOut = IEarnRouterUniversalMinimal(EARN_ROUTER).addLiquidityUnbalanced(
            action.pool, amounts, action.minimumAmountOut, false, bytes("")
        );
        for (uint256 index = 0; index < tokens.length; ++index) _revokePermit2(tokens[index]);
    }

    function _removeEarn(Plan memory plan, Action memory action, uint256 amountIn)
        private
        returns (uint256 aggregateOut)
    {
        if (
            action.pool == address(0) || action.pool != action.tokenIn || action.tokenOut != address(0)
                || action.fee != 0 || action.minimumAmountOut != 0
        ) revert InvalidAction();
        address[] memory tokens = _earnPoolTokens(action.pool);
        for (uint256 index = 0; index < tokens.length; ++index) _requireTracked(plan, tokens[index]);
        uint256[] memory minimumAmounts = new uint256[](tokens.length);
        _forceApprove(action.pool, EARN_VAULT, amountIn);
        uint256[] memory outputs = IEarnRouterUniversalMinimal(EARN_ROUTER).removeLiquidityProportional(
            action.pool, amountIn, minimumAmounts, false, bytes("")
        );
        _forceApprove(action.pool, EARN_VAULT, 0);
        if (outputs.length != tokens.length) revert SettlementMismatch();
        for (uint256 index = 0; index < outputs.length; ++index) aggregateOut += outputs[index];
    }

    function _finish(Plan memory plan, uint256[] memory baselines, uint256 principal)
        private
        view
        returns (uint256 grossProfit)
    {
        _validateResiduals(plan, baselines);
        uint256 current = IERC20UniversalMinimal(plan.settlementToken).balanceOf(address(this));
        uint256 required = _baselineFor(plan, baselines, plan.settlementToken) + principal;
        if (current < required) revert ProfitTooLow(0, plan.minimumProfit);
        grossProfit = current - required;
        if (grossProfit < plan.minimumProfit) revert ProfitTooLow(grossProfit, plan.minimumProfit);
    }

    function _validateResiduals(Plan memory plan, uint256[] memory baselines) private view {
        for (uint256 index = 0; index < plan.trackedTokens.length; ++index) {
            TrackedToken memory tracked = plan.trackedTokens[index];
            if (tracked.token == plan.settlementToken) continue;
            uint256 current = IERC20UniversalMinimal(tracked.token).balanceOf(address(this));
            uint256 baseline = baselines[index];
            if (current > baseline && current - baseline > tracked.maximumResidual) revert SettlementMismatch();
        }
    }

    function _validatePlan(Plan memory plan) private view {
        if (
            plan.settlementToken == address(0) || plan.minimumProfit == 0 || block.timestamp > plan.deadline
                || plan.trackedTokens.length == 0 || plan.trackedTokens.length > MAX_TRACKED_TOKENS
                || plan.actions.length == 0 || plan.actions.length > MAX_ACTIONS
        ) revert InvalidPlan();
        bool hasSettlement;
        for (uint256 index = 0; index < plan.trackedTokens.length; ++index) {
            address token = plan.trackedTokens[index].token;
            if (token == address(0)) revert InvalidPlan();
            if (token == plan.settlementToken) hasSettlement = true;
            for (uint256 prior = 0; prior < index; ++prior) {
                if (plan.trackedTokens[prior].token == token) revert InvalidPlan();
            }
        }
        if (!hasSettlement) revert InvalidPlan();
        for (uint256 index = 0; index < plan.actions.length; ++index) {
            Action memory action = plan.actions[index];
            if (action.kind == ActionKind.EARN_ADD_UNBALANCED) {
                _requireTracked(plan, action.pool);
            } else if (action.kind == ActionKind.EARN_REMOVE_PROPORTIONAL) {
                _requireTracked(plan, action.pool);
            } else {
                if (action.tokenIn == address(0) || action.tokenOut == address(0) || action.tokenIn == action.tokenOut) {
                    revert InvalidAction();
                }
                _requireTracked(plan, action.tokenIn);
                _requireTracked(plan, action.tokenOut);
            }
        }
    }

    function _snapshotBaselines(Plan memory plan, uint256 settlementPrincipal)
        private
        view
        returns (uint256[] memory baselines)
    {
        baselines = new uint256[](plan.trackedTokens.length);
        for (uint256 index = 0; index < plan.trackedTokens.length; ++index) {
            address token = plan.trackedTokens[index].token;
            uint256 balance = IERC20UniversalMinimal(token).balanceOf(address(this));
            if (token == plan.settlementToken) {
                if (balance < settlementPrincipal) revert InsufficientPrincipal();
                balance -= settlementPrincipal;
            }
            baselines[index] = balance;
        }
    }

    function _availableAmount(Plan memory plan, uint256[] memory baselines, address token, uint256 requested)
        private
        view
        returns (uint256 amount)
    {
        uint256 balance = IERC20UniversalMinimal(token).balanceOf(address(this));
        uint256 baseline = _baselineFor(plan, baselines, token);
        if (balance <= baseline) revert InsufficientPrincipal();
        uint256 available = balance - baseline;
        amount = requested == 0 ? available : requested;
        if (amount == 0 || amount > available || amount > uint256(uint128(type(int128).max))) revert InvalidAmount();
    }

    function _baselineFor(Plan memory plan, uint256[] memory baselines, address token)
        private
        pure
        returns (uint256)
    {
        for (uint256 index = 0; index < plan.trackedTokens.length; ++index) {
            if (plan.trackedTokens[index].token == token) return baselines[index];
        }
        revert InvalidPlan();
    }

    function _requireTracked(Plan memory plan, address token) private pure {
        for (uint256 index = 0; index < plan.trackedTokens.length; ++index) {
            if (plan.trackedTokens[index].token == token) return;
        }
        revert InvalidPlan();
    }

    function _validateEarnPool(address pool, address tokenIn, address tokenOut) private view {
        address[] memory tokens = _earnPoolTokens(pool);
        bool foundIn;
        bool foundOut;
        for (uint256 index = 0; index < tokens.length; ++index) {
            if (tokens[index] == tokenIn) foundIn = true;
            if (tokens[index] == tokenOut) foundOut = true;
        }
        if (!foundIn || !foundOut) revert CanonicalPoolMismatch();
    }

    function _earnPoolTokens(address pool) private view returns (address[] memory tokens) {
        IEarnVaultUniversalMinimal vault = IEarnVaultUniversalMinimal(EARN_VAULT);
        if (!vault.isPoolInitialized(pool) || vault.isPoolPaused(pool) || vault.isPoolInRecoveryMode(pool)) {
            revert CanonicalPoolMismatch();
        }
        tokens = vault.getPoolTokens(pool);
        if (tokens.length < 2 || tokens.length > 8) revert CanonicalPoolMismatch();
    }

    function _approvePermit2(address token, uint256 amount) private {
        if (amount == 0 || amount > type(uint160).max) revert InvalidAmount();
        _forceApprove(token, PERMIT2, amount);
        IPermit2UniversalMinimal(PERMIT2).approve(token, EARN_ROUTER, uint160(amount), uint48(block.timestamp));
    }

    function _revokePermit2(address token) private {
        IPermit2UniversalMinimal(PERMIT2).approve(token, EARN_ROUTER, 0, 0);
        _forceApprove(token, PERMIT2, 0);
    }

    function _validateV4Delta(int256 delta, bool zeroForOne, uint256 expectedInput)
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

    function _toSigned(uint256 value) private pure returns (int256) {
        if (value > uint256(type(int256).max)) revert InvalidAmount();
        return int256(value);
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

    function _setV3Context(address pool, address token, uint256 amount, bool token0In) private {
        bytes32 poolSlot = V3_POOL_SLOT;
        bytes32 tokenSlot = V3_TOKEN_SLOT;
        bytes32 amountSlot = V3_AMOUNT_SLOT;
        bytes32 token0Slot = V3_TOKEN0_SLOT;
        assembly ("memory-safe") {
            tstore(poolSlot, pool)
            tstore(tokenSlot, token)
            tstore(amountSlot, amount)
            tstore(token0Slot, token0In)
        }
    }

    function _clearV3Context() private {
        bytes32 poolSlot = V3_POOL_SLOT;
        bytes32 tokenSlot = V3_TOKEN_SLOT;
        bytes32 amountSlot = V3_AMOUNT_SLOT;
        bytes32 token0Slot = V3_TOKEN0_SLOT;
        assembly ("memory-safe") {
            tstore(poolSlot, 0)
            tstore(tokenSlot, 0)
            tstore(amountSlot, 0)
            tstore(token0Slot, 0)
        }
    }

    function _v3Pool() private view returns (address value) {
        bytes32 slot = V3_POOL_SLOT;
        assembly ("memory-safe") {
            value := tload(slot)
        }
    }

    function _v3Token() private view returns (address value) {
        bytes32 slot = V3_TOKEN_SLOT;
        assembly ("memory-safe") {
            value := tload(slot)
        }
    }

    function _v3Amount() private view returns (uint256 value) {
        bytes32 slot = V3_AMOUNT_SLOT;
        assembly ("memory-safe") {
            value := tload(slot)
        }
    }

    function _v3Token0() private view returns (bool value) {
        bytes32 slot = V3_TOKEN0_SLOT;
        assembly ("memory-safe") {
            value := tload(slot)
        }
    }
}
