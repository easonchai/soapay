// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

interface IWETH9 {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
}

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function factory() external view returns (address);
    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool);
    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

interface IUniswapV3Factory {
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
}

/// @notice TESTNET ONLY (D-52): a Uniswap v3 mock USDC / WETH pool on Base Sepolia at the SDK's
///         default fee tier (500, swap.ts DEFAULT_V3_FEE_TIER), initialised at USDC_PER_ETH and seeded
///         with full-range liquidity from the deployer. The deployer (MockUSDC admin) grants itself
///         MINTER_ROLE for the USDC side and revokes it again in the same run.
///
///   MOCK_USDC=0x... forge script script/SetupMockPool.s.sol --rpc-url base_sepolia \
///     --private-key $DEPLOYER_PRIVATE_KEY --broadcast
///
///   Optional: WETH_AMOUNT (wei, default 0.05 ether), USDC_PER_ETH (whole USDC, default 3000), FEE (default 500).
contract SetupMockPool is Script {
    /// Uniswap v3 on Base Sepolia (docs.uniswap.org deployments; factory() checked on-chain).
    address internal constant POSITION_MANAGER = 0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    int24 internal constant MAX_TICK = 887272;

    struct Plan {
        MockUSDC usdc;
        uint24 fee;
        int24 tickUpper;
        uint256 wethAmount;
        uint256 usdcAmount;
        address token0;
        address token1;
        uint256 amount0;
        uint256 amount1;
        uint160 sqrtPriceX96;
    }

    function _plan() internal view returns (Plan memory p) {
        p.usdc = MockUSDC(vm.envAddress("MOCK_USDC"));
        p.wethAmount = vm.envOr("WETH_AMOUNT", uint256(0.05 ether));
        p.fee = uint24(vm.envOr("FEE", uint256(500)));
        p.usdcAmount = (p.wethAmount * vm.envOr("USDC_PER_ETH", uint256(3000)) * 1e6) / 1e18;
        int24 spacing = IUniswapV3Factory(INonfungiblePositionManager(POSITION_MANAGER).factory()).feeAmountTickSpacing(p.fee);
        require(spacing > 0, "fee tier not enabled");
        p.tickUpper = (MAX_TICK / spacing) * spacing;
        bool usdcIsToken0 = address(p.usdc) < WETH;
        (p.token0, p.token1) = usdcIsToken0 ? (address(p.usdc), WETH) : (WETH, address(p.usdc));
        (p.amount0, p.amount1) = usdcIsToken0 ? (p.usdcAmount, p.wethAmount) : (p.wethAmount, p.usdcAmount);
        // sqrtPriceX96 = sqrt(amount1 / amount0) * 2^96 = sqrt(amount1 * 2^192 / amount0).
        p.sqrtPriceX96 = uint160(Math.sqrt(Math.mulDiv(p.amount1, 1 << 192, p.amount0)));
    }

    /// The deployer (admin) mints the USDC side with a temporary MINTER_ROLE.
    function _mintUsdc(Plan memory p, address deployer) internal {
        bytes32 minterRole = p.usdc.MINTER_ROLE();
        bool hadRole = p.usdc.hasRole(minterRole, deployer);
        if (!hadRole) p.usdc.grantRole(minterRole, deployer);
        p.usdc.mint(deployer, p.usdcAmount);
        if (!hadRole) p.usdc.revokeRole(minterRole, deployer);
    }

    function run() external {
        require(block.chainid == 84532 || block.chainid == 31337, "testnet-only");
        Plan memory p = _plan();
        INonfungiblePositionManager npm = INonfungiblePositionManager(POSITION_MANAGER);

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        _mintUsdc(p, deployer);
        IWETH9(WETH).deposit{value: p.wethAmount}();
        IWETH9(WETH).approve(POSITION_MANAGER, p.wethAmount);
        p.usdc.approve(POSITION_MANAGER, p.usdcAmount);

        address pool = npm.createAndInitializePoolIfNecessary(p.token0, p.token1, p.fee, p.sqrtPriceX96);
        (uint256 tokenId, uint128 liquidity, uint256 used0, uint256 used1) = npm.mint(
            INonfungiblePositionManager.MintParams({
                token0: p.token0,
                token1: p.token1,
                fee: p.fee,
                tickLower: -p.tickUpper,
                tickUpper: p.tickUpper,
                amount0Desired: p.amount0,
                amount1Desired: p.amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: deployer,
                deadline: block.timestamp + 1 hours
            })
        );
        vm.stopBroadcast();

        console.log("pool", pool);
        console.log("position tokenId", tokenId);
        console.log("liquidity", uint256(liquidity));
        console.log("token0", p.token0, "used", used0);
        console.log("token1", p.token1, "used", used1);
    }
}
