// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IPQVerifier} from "../../src/interfaces/IPQVerifier.sol";

/// @notice TESTS ONLY. Never deploy to a public network: it accepts an ECDSA signature as the "PQ" signature.
///         pubKey = the 20-byte owner address.
contract MockPQVerifier is IPQVerifier {
    function scheme() external pure returns (bytes32) {
        return keccak256("MOCK-ECDSA-NOT-PQ");
    }

    function verify(bytes calldata pubKey, bytes32 digest, bytes calldata sig) external pure returns (bool) {
        if (pubKey.length != 20) return false;
        (address rec, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        return err == ECDSA.RecoverError.NoError && rec == address(bytes20(pubKey));
    }
}

/// @notice Tether-style token: transfer/transferFrom/approve return nothing (not even a bool).
contract MockUSDT {
    string public constant name = "Tether USD (mock)";
    string public constant symbol = "USDT";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external {
        _move(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external {
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// @notice Malicious token that re-enters a target during transfer().
contract ReentrantToken {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    address public target;
    bytes public payload;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        if (target != address(0)) {
            address t = target;
            target = address(0);
            (bool ok, bytes memory ret) = t.call(payload);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
        return true;
    }
}

/// @notice Stand-in for Hedera's HTS precompile at 0x167 (etched in tests).
contract MockHTS {
    // etched code starts with empty storage, so 0 means "succeed" (HTS SUCCESS = 22)
    mapping(address => mapping(address => bool)) public associated;
    int64 public failCode;

    function setFailCode(int64 code) external {
        failCode = code;
    }

    function associateToken(address account, address token) external returns (int64) {
        associated[account][token] = true;
        return failCode == 0 ? int64(22) : failCode;
    }
}
