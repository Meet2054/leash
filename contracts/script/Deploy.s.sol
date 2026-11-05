// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ZKNOX_ethfalcon} from "ETHFALCON/ZKNOX_ethfalcon.sol";
import {EthFalconVerifier} from "../src/verifiers/EthFalconVerifier.sol";
import {LeashFactory} from "../src/LeashFactory.sol";

/// Deploys ZKNOX_ethfalcon → EthFalconVerifier → LeashFactory (+ vault implementation).
/// Never deploys MockPQVerifier: public deployments always use the real Falcon verifier.
///
/// env: RELAYER_PK_<CHAIN> (broadcaster = relayer), TOKEN_ADDRESS, ATTESTOR_PK (address only is used),
///      RELAYER_FEE_RECIPIENT, CLAIM_FEE (atomic, default 1000 = 0.001 USDT), HTS_ASSOCIATE (default false)
contract Deploy is Script {
    function run() external {
        uint256 relayerPk = vm.envUint("DEPLOYER_PK");
        address relayer = vm.addr(relayerPk);
        address token = vm.envAddress("TOKEN_ADDRESS");
        address attestor = vm.addr(vm.envUint("ATTESTOR_PK"));
        address feeRecipient = vm.envAddress("RELAYER_FEE_RECIPIENT");
        uint256 claimFee = vm.envOr("CLAIM_FEE", uint256(1000));
        bool hts = vm.envOr("HTS_ASSOCIATE", false);

        vm.startBroadcast(relayerPk);
        ZKNOX_ethfalcon falcon = new ZKNOX_ethfalcon();
        EthFalconVerifier verifier = new EthFalconVerifier(address(falcon));
        LeashFactory factory = new LeashFactory(token, attestor, relayer, feeRecipient, claimFee, address(verifier), hts);
        vm.stopBroadcast();

        console.log("ZKNOX_ethfalcon  ", address(falcon));
        console.log("EthFalconVerifier", address(verifier));
        console.log("LeashFactory     ", address(factory));
        console.log("LeashVault impl  ", factory.implementation());

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "token", token);
        vm.serializeAddress(o, "attestor", attestor);
        vm.serializeAddress(o, "relayer", relayer);
        vm.serializeAddress(o, "feeRecipient", feeRecipient);
        vm.serializeUint(o, "claimFee", claimFee);
        vm.serializeAddress(o, "zknoxEthFalcon", address(falcon));
        vm.serializeAddress(o, "ethFalconVerifier", address(verifier));
        vm.serializeAddress(o, "vaultImplementation", factory.implementation());
        vm.serializeUint(o, "deployedAtBlock", block.number);
        string memory out = vm.serializeAddress(o, "factory", address(factory));
        vm.writeJson(out, string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json"));
    }
}
