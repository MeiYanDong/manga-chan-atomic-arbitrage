// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IUniversalCallbackTest {
    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external;
    function unlockCallback(bytes calldata data) external returns (bytes memory);
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

interface IMockTokenUniversal {
    function mint(address to, uint256 amount) external;
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IUniversalSettlementRecorder {
    function recordSettlement(uint256 amount) external;
}

contract UniversalMockToken {
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        if (to == POOL_MANAGER) IUniversalSettlementRecorder(POOL_MANAGER).recordSettlement(amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "BALANCE");
        require(allowance[from][msg.sender] >= amount, "ALLOWANCE");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract UniversalMockMorpho {
    function flashLoan(address token, uint256 assets, bytes calldata data) external {
        IMockTokenUniversal(token).mint(msg.sender, assets);
        IUniversalCallbackTest(msg.sender).onMorphoFlashLoan(assets, data);
        require(IMockTokenUniversal(token).transferFrom(msg.sender, address(this), assets), "REPAY");
    }
}

contract UniversalMockV3Factory {
    mapping(bytes32 key => address pool) private pools;

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        pools[_key(tokenA, tokenB, fee)] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        return pools[_key(tokenA, tokenB, fee)];
    }

    function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(token0, token1, fee));
    }
}

contract UniversalMockV3Pool {
    address public token0;
    address public token1;
    uint256 public bonus;

    function configure(address token0_, address token1_, uint256 bonus_) external {
        require(token0_ < token1_, "ORDER");
        token0 = token0_;
        token1 = token1_;
        bonus = bonus_;
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata)
        external
        returns (int256 amount0, int256 amount1)
    {
        uint256 input = uint256(amountSpecified);
        uint256 output = input + bonus;
        if (zeroForOne) {
            IUniversalCallbackTest(msg.sender).uniswapV3SwapCallback(int256(input), -int256(output), bytes(""));
            IMockTokenUniversal(token1).mint(recipient, output);
            return (int256(input), -int256(output));
        }
        IUniversalCallbackTest(msg.sender).uniswapV3SwapCallback(-int256(output), int256(input), bytes(""));
        IMockTokenUniversal(token0).mint(recipient, output);
        return (-int256(output), int256(input));
    }
}

contract UniversalMockV2Factory {
    mapping(bytes32 key => address pair) private pairs;

    function setPair(address tokenA, address tokenB, address pair) external {
        pairs[_key(tokenA, tokenB)] = pair;
    }

    function getPair(address tokenA, address tokenB) external view returns (address) {
        return pairs[_key(tokenA, tokenB)];
    }

    function _key(address tokenA, address tokenB) private pure returns (bytes32) {
        return tokenA < tokenB ? keccak256(abi.encode(tokenA, tokenB)) : keccak256(abi.encode(tokenB, tokenA));
    }
}

contract UniversalMockV2Pair {
    address public token0;
    address public token1;
    uint112 public reserve0;
    uint112 public reserve1;

    function configure(address token0_, address token1_, uint112 reserve0_, uint112 reserve1_) external {
        token0 = token0_;
        token1 = token1_;
        reserve0 = reserve0_;
        reserve1 = reserve1_;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, 0);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata) external {
        if (amount0Out > 0) IMockTokenUniversal(token0).mint(to, amount0Out);
        if (amount1Out > 0) IMockTokenUniversal(token1).mint(to, amount1Out);
    }
}

contract UniversalMockPoolManager {
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

    uint256 public bonus;
    address private outputToken;
    uint256 private settlement;

    function configure(uint256 bonus_) external {
        bonus = bonus_;
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUniversalCallbackTest(msg.sender).unlockCallback(data);
    }

    function sync(address) external {}

    function recordSettlement(uint256 amount) external {
        settlement += amount;
    }

    function settle() external returns (uint256 paid) {
        paid = settlement;
        settlement = 0;
    }

    function swap(PoolKey memory key, SwapParams memory params, bytes calldata) external returns (int256) {
        uint256 input = uint256(-params.amountSpecified);
        uint256 output = input + bonus;
        outputToken = params.zeroForOne ? key.currency1 : key.currency0;
        int128 signedInput = int128(int256(input));
        int128 signedOutput = int128(int256(output));
        return params.zeroForOne ? _pack(-signedInput, signedOutput) : _pack(signedOutput, -signedInput);
    }

    function take(address currency, address to, uint256 amount) external {
        require(currency == outputToken, "OUTPUT");
        IMockTokenUniversal(currency).mint(to, amount);
    }

    function _pack(int128 amount0, int128 amount1) private pure returns (int256) {
        return (int256(amount0) << 128) | int256(uint256(uint128(amount1)));
    }
}

contract UniversalMockVault {
    mapping(address pool => address[] tokens) private poolTokens;
    mapping(address pool => bool) public initialized;

    function configurePool(address pool, address[] calldata tokens) external {
        delete poolTokens[pool];
        for (uint256 index = 0; index < tokens.length; ++index) poolTokens[pool].push(tokens[index]);
        initialized[pool] = true;
    }

    function isPoolInitialized(address pool) external view returns (bool) {
        return initialized[pool];
    }

    function isPoolPaused(address) external pure returns (bool) {
        return false;
    }

    function isPoolInRecoveryMode(address) external pure returns (bool) {
        return false;
    }

    function getPoolTokens(address pool) external view returns (address[] memory) {
        return poolTokens[pool];
    }

    function pull(address token, address from, address to, uint256 amount) external {
        require(IMockTokenUniversal(token).transferFrom(from, to, amount), "PULL");
    }
}

contract UniversalMockPermit2 {
    mapping(address owner => mapping(address token => mapping(address spender => uint160 amount))) public allowance;

    function approve(address token, address spender, uint160 amount, uint48) external {
        allowance[msg.sender][token][spender] = amount;
    }

    function spend(address owner, address token, address spender, uint256 amount) external {
        require(msg.sender == spender && allowance[owner][token][spender] >= amount, "PERMIT2");
        allowance[owner][token][spender] -= uint160(amount);
        require(IMockTokenUniversal(token).transferFrom(owner, spender, amount), "SPEND");
    }
}

contract UniversalMockEarnRouter {
    address internal constant VAULT = 0x28082618Ba2073E602230188E4F4C46e9b2169EB;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 public addBonus;
    uint256 public removeBonus;

    function configure(uint256 addBonus_, uint256 removeBonus_) external {
        addBonus = addBonus_;
        removeBonus = removeBonus_;
    }

    function swapSingleTokenExactIn(
        address,
        address tokenIn,
        address tokenOut,
        uint256 exactAmountIn,
        uint256,
        uint256,
        bool,
        bytes calldata
    ) external returns (uint256 amountOut) {
        UniversalMockPermit2(PERMIT2).spend(msg.sender, tokenIn, address(this), exactAmountIn);
        amountOut = exactAmountIn;
        IMockTokenUniversal(tokenOut).mint(msg.sender, amountOut);
    }

    function addLiquidityUnbalanced(address pool, uint256[] memory amounts, uint256, bool, bytes memory)
        external
        returns (uint256 bptAmountOut)
    {
        address[] memory tokens = UniversalMockVault(VAULT).getPoolTokens(pool);
        require(tokens.length == amounts.length, "TOKENS");
        for (uint256 index = 0; index < tokens.length; ++index) {
            UniversalMockPermit2(PERMIT2).spend(msg.sender, tokens[index], address(this), amounts[index]);
            bptAmountOut += amounts[index];
        }
        bptAmountOut += addBonus;
        IMockTokenUniversal(pool).mint(msg.sender, bptAmountOut);
    }

    function removeLiquidityProportional(address pool, uint256 exactBptAmountIn, uint256[] memory minimums, bool, bytes memory)
        external
        returns (uint256[] memory outputs)
    {
        UniversalMockVault(VAULT).pull(pool, msg.sender, address(this), exactBptAmountIn);
        address[] memory tokens = UniversalMockVault(VAULT).getPoolTokens(pool);
        require(tokens.length == minimums.length, "MINIMUMS");
        outputs = new uint256[](tokens.length);
        for (uint256 index = 0; index < tokens.length; ++index) {
            outputs[index] = exactBptAmountIn / tokens.length;
            if (index == 0) outputs[index] += removeBonus;
            IMockTokenUniversal(tokens[index]).mint(msg.sender, outputs[index]);
        }
    }
}
