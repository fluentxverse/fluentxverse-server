// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IReviewAggregationBridge {
    function verifyProofAggregation(uint256 domainId, uint256 aggregationId, bytes32 leaf,
        bytes32[] calldata merklePath, uint256 leafCount, uint256 index) external view returns (bool);
}

/// @notice Publishes salted review commitments, not individual ratings or learner identities.
contract AnonymousReviewRegistry {
    uint256 private constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    address public immutable owner;
    IReviewAggregationBridge public immutable bridge;
    uint256 public immutable domainId;
    bytes32 public immutable vkHash;
    uint256 public constant proofDepth = 8;
    uint256 public constant minBatch = 5;
    bool public enabled;
    bool private entered;
    struct Cohort { uint256 root; uint64 opensAt; uint64 closesAt; uint16 memberCount; }
    mapping(uint256 => Cohort) public cohorts;
    mapping(bytes32 => bytes32) public accepted;
    event CohortRegistered(uint256 indexed scopeHash, uint256 root, uint64 opensAt, uint64 closesAt, uint16 memberCount);
    event ReviewAccepted(uint256 indexed scopeHash, uint256 indexed nullifier, uint256 messageHash, bytes32 statement);

    constructor(address governance, address receiptBridge, uint256 domain, bytes32 approvedVkHash) {
        require(governance != address(0) && receiptBridge.code.length > 0 && domain > 0 && approvedVkHash != bytes32(0), "Invalid configuration");
        owner = governance; bridge = IReviewAggregationBridge(receiptBridge); domainId = domain; vkHash = approvedVkHash;
    }
    function registerCohort(uint256 scopeHash, uint256 root, uint64 opensAt, uint64 closesAt, uint16 memberCount) external {
        require(msg.sender == owner, "Governance only");
        require(scopeHash > 0 && scopeHash < FIELD && root > 0 && root < FIELD, "Invalid field");
        require(cohorts[scopeHash].root == 0, "Immutable cohort");
        require(opensAt <= block.timestamp && closesAt > block.timestamp && closesAt == opensAt + 7 days, "Invalid window");
        require(memberCount >= minBatch && memberCount <= 256, "Invalid cohort size");
        cohorts[scopeHash] = Cohort(root, opensAt, closesAt, memberCount);
        emit CohortRegistered(scopeHash, root, opensAt, closesAt, memberCount);
    }
    function statementLeaf(uint256[4] calldata signals) public view returns (bytes32) {
        bytes memory encoded = new bytes(128);
        for (uint256 i; i < 4; ++i) {
            require(signals[i] < FIELD, "Noncanonical field");
            for (uint256 j; j < 32; ++j) encoded[i * 32 + j] = bytes1(uint8(signals[i] >> (8 * j)));
        }
        return keccak256(abi.encodePacked(keccak256("groth16"), vkHash, sha256(""), keccak256(encoded)));
    }
    function reviewKey(uint256 scopeHash, uint256 nullifier) public pure returns (bytes32) {
        return keccak256(abi.encode(scopeHash, nullifier));
    }
    function acceptReview(uint256[4] calldata signals, uint256 aggregationId, bytes32[] calldata merklePath,
        uint256 leafCount, uint256 index) external {
        require(!entered, "Reentrant receipt"); entered = true;
        Cohort memory cohort = cohorts[signals[3]];
        require(enabled && cohort.root != 0 && cohort.root == signals[0], "Inactive cohort");
        require(block.timestamp >= cohort.opensAt && block.timestamp < cohort.closesAt, "Review window closed");
        require(signals[1] > 0 && leafCount > 0 && index < leafCount, "Invalid claim");
        bytes32 key = reviewKey(signals[3], signals[1]);
        require(accepted[key] == bytes32(0), "Already reviewed");
        bytes32 leaf = statementLeaf(signals);
        require(bridge.verifyProofAggregation(domainId, aggregationId, leaf, merklePath, leafCount, index), "Invalid zkVerify receipt");
        accepted[key] = leaf;
        emit ReviewAccepted(signals[3], signals[1], signals[2], leaf);
        entered = false;
    }
    function setEnabled(bool value) external { require(msg.sender == owner, "Governance only"); enabled = value; }
}
