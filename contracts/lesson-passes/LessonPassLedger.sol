// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IPassReceiptBridge {
    function verifyProofAggregation(uint256, uint256, bytes32, bytes32[] calldata, uint256, uint256) external view returns (bool);
}

/// @notice Issuer-authorized, one-use lesson entitlements. No NFT, ERC-1155, or public student balances.
contract LessonPassLedger {
    uint256 private constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    address public immutable owner;
    IPassReceiptBridge public immutable bridge;
    uint256 public immutable domainId;
    bytes32 public immutable vkHash;
    uint256 public immutable scopeHash;
    bool public enabled;
    bool private entered;
    struct Batch { uint256 root; uint16 count; }
    struct Reservation { uint256 nullifier; uint256 refundCommitment; uint8 state; }
    mapping(bytes32 => Batch) public batches;
    mapping(uint256 => bool) public approvedRoots;
    mapping(uint256 => bool) public spent;
    mapping(bytes32 => Reservation) public reservations;
    event BatchRegistered(bytes32 indexed batchId, uint256 root, uint16 count);
    event PassReserved(bytes32 indexed reservation, uint256 nullifier, uint256 refundCommitment);
    event PassSettled(bytes32 indexed reservation);
    event PassReturned(bytes32 indexed reservation, uint256 refundCommitment);
    modifier governance() { require(msg.sender == owner, "Issuer only"); _; }

    constructor(address issuer, address receiptBridge, uint256 domain, bytes32 approvedVk) {
        require(issuer != address(0) && receiptBridge.code.length > 0 && domain > 0 && approvedVk != bytes32(0), "Invalid configuration");
        owner = issuer; bridge = IPassReceiptBridge(receiptBridge); domainId = domain; vkHash = approvedVk;
        uint256 scope = uint256(keccak256(abi.encode(keccak256("fluentxverse.lesson-pass.v1"), block.chainid, address(this)))) >> 8;
        scopeHash = uint256(keccak256(abi.encode(scope))) >> 8;
    }
    function setEnabled(bool value) external governance { enabled = value; }
    function registerBatch(bytes32 id, uint256 root, uint16 count) external governance {
        require(id != bytes32(0) && batches[id].root == 0 && root > 0 && root < FIELD && count > 0 && count <= 256, "Invalid immutable batch");
        batches[id] = Batch(root, count); approvedRoots[root] = true;
        emit BatchRegistered(id, root, count);
    }
    function statementLeaf(uint256[4] calldata signals) public view returns (bytes32) {
        bytes memory encoded = new bytes(128);
        for (uint256 i; i < 4; ++i) {
            require(signals[i] < FIELD, "Invalid field");
            for (uint256 j; j < 32; ++j) encoded[i * 32 + j] = bytes1(uint8(signals[i] >> (8 * j)));
        }
        return keccak256(abi.encodePacked(keccak256("groth16"), vkHash, sha256(""), keccak256(encoded)));
    }
    function reservePass(bytes32 id, uint256 refundCommitment, uint64 deadline, uint256[4] calldata signals,
        uint256 aggregation, bytes32[] calldata path, uint256 leaves, uint256 index) external governance {
        require(enabled && !entered && id != bytes32(0) && block.timestamp <= deadline, "Inactive or expired authorization");
        require(approvedRoots[signals[0]] && signals[3] == scopeHash && signals[1] > 0 && !spent[signals[1]], "Invalid or spent pass");
        require(reservations[id].state == 0 && refundCommitment > 0 && refundCommitment < FIELD && leaves > 0 && index < leaves, "Invalid reservation");
        uint256 message = uint256(keccak256(abi.encode(keccak256("fluentxverse.lesson-pass.v1:reserve"), id, signals[0], refundCommitment, deadline)));
        require(signals[2] == uint256(keccak256(abi.encode(message))) >> 8, "Authorization binding differs");
        entered = true;
        require(bridge.verifyProofAggregation(domainId, aggregation, statementLeaf(signals), path, leaves, index), "Unverified zkVerify receipt");
        spent[signals[1]] = true;
        reservations[id] = Reservation(signals[1], refundCommitment, 1);
        entered = false;
        emit PassReserved(id, signals[1], refundCommitment);
    }
    function settlePass(bytes32 id) external governance {
        require(reservations[id].state == 1, "Reservation already finalized");
        reservations[id].state = 2; emit PassSettled(id);
    }
    function returnPass(bytes32 id) external governance {
        require(reservations[id].state == 1, "Reservation already finalized");
        reservations[id].state = 3; emit PassReturned(id, reservations[id].refundCommitment);
    }
}
