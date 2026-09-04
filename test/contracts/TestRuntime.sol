// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IExecutorCallbacks {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

interface IMintableToken {
    function mint(address to, uint256 amount) external;
}

interface ISettlementRecorder {
    function recordSettlement(uint256 amount) external;
}

contract MockToken {
    mapping(address account => uint256 amount) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockPoolManager {
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

    address internal constant ENTRY_TOKEN = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    uint256 private settlement;

    function recordSettlement(uint256 amount) external {
        settlement = amount;
    }

    function unlock(bytes calldata data) external returns (bytes memory result) {
        result = IExecutorCallbacks(msg.sender).unlockCallback(data);
    }

    function sync(address) external {}

    function settle() external returns (uint256 paid) {
        paid = settlement;
        settlement = 0;
    }

    function swap(PoolKey memory key, SwapParams memory params, bytes calldata) external pure returns (int256) {
        uint256 input = uint256(-params.amountSpecified);
        require(input <= uint256(uint128(type(int128).max)), "INPUT");
        int128 signedInput = int128(int256(input));
        if (key.currency1 == ENTRY_TOKEN) return _pack(signedInput, -signedInput);
        return _pack(-signedInput, signedInput);
    }

    function take(address, address, uint256) external pure {}

    function _pack(int128 amount0, int128 amount1) private pure returns (int256) {
        return (int256(amount0) << 128) | int256(uint256(uint128(amount1)));
    }
}

contract MockV3Pool {
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    uint8 public mode;
    uint256 public profit;

    function configure(uint8 mode_, uint256 profit_) external {
        mode = mode_;
        profit = profit_;
    }

    function swap(address recipient, bool, int256 amountSpecified, uint160, bytes calldata)
        external
        returns (int256 amount0, int256 amount1)
    {
        uint256 input = uint256(amountSpecified);
        if (mode == 1) {
            ISettlementRecorder(POOL_MANAGER).recordSettlement(input);
            IExecutorCallbacks(msg.sender).uniswapV3SwapCallback(int256(input), -int256(input), bytes(""));
            return (int256(input), -int256(input));
        }
        require(mode == 2, "MODE");
        uint256 output = input + profit;
        IExecutorCallbacks(msg.sender).uniswapV3SwapCallback(-int256(output), int256(input), bytes(""));
        IMintableToken(USDG).mint(recipient, output);
        return (-int256(output), int256(input));
    }
}
