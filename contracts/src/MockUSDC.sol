// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title MockUSDC
/// @notice TESTNET ONLY (Base Sepolia, D-52). A stand-in for Circle USDC so judges can try Soapay
///         without Circle's faucet: 6 decimals, EIP-2612 permit (StealthDisperse.payWithPermit and
///         Permit2 flows need it), and minting restricted to MINTER_ROLE (the API's faucet key).
///         No other logic. It is a plain token: it holds no funds and keeps no state beyond balances.
contract MockUSDC is ERC20, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @param owner   DEFAULT_ADMIN_ROLE (the deployer): grants and revokes MINTER_ROLE.
    /// @param minter  MINTER_ROLE (the API faucet/relayer key). May be address(0) to skip.
    constructor(address owner, address minter) ERC20("USD Coin (Soapay test)", "USDC") ERC20Permit("USD Coin (Soapay test)") {
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        if (minter != address(0)) _grantRole(MINTER_ROLE, minter);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice EIP-712 domain version, exposed like Circle's FiatToken `version()` so USDC permit
    ///         signers that read it work unchanged. ERC20Permit's domain version is "1".
    function version() external pure returns (string memory) {
        return "1";
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }
}
