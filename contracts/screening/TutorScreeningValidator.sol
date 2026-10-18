// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IZkVerifyAggregation {
    function verifyProofAggregation(uint256 domainId, uint256 aggregationId, bytes32 leaf,
        bytes32[] calldata merklePath, uint256 leafCount, uint256 index) external view returns (bool);
}
interface IAgentValidationRegistry {
    function getValidationStatus(bytes32 requestHash) external view returns
        (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string memory tag, uint256 lastUpdate);
    function validationResponse(bytes32 requestHash, uint8 response, string calldata responseURI, bytes32 responseHash, string calldata tag) external;
}

/// @notice Validates screening credentials, not tutor scores or model correctness.
contract TutorScreeningValidator {
    uint256 private constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    bytes32 public constant PROVING_SYSTEM = keccak256("groth16");
    bytes32 public constant VERSION = sha256("");
    address public immutable owner;
    IZkVerifyAggregation public immutable bridge;
    IAgentValidationRegistry public immutable registry;
    uint256 public immutable domainId;
    uint256 public immutable agentId;
    bytes32 public immutable vkHash;
    uint256 public immutable policyHash;
    uint256 public immutable schemaHash;
    uint256 public immutable issuerHash;
    bool public enabled;
    bool private entered;
    struct Certification { bytes32 requestHash; uint64 expiresAt; }
    mapping(uint256 => Certification) public certifications;
    mapping(uint256 => bool) public revoked;

    event Certified(uint256 indexed commitment, bytes32 indexed requestHash, uint256 expiresAt);
    event Revoked(uint256 indexed commitment);
    event Enabled(bool enabled);

    constructor(address governance, address aggregationBridge, address validationRegistry, uint256 domain,
        uint256 screeningAgentId, bytes32 approvedVkHash, uint256 approvedPolicy, uint256 approvedSchema, uint256 approvedIssuer) {
        require(governance != address(0) && aggregationBridge.code.length > 0 && validationRegistry.code.length > 0, "Invalid contracts/governance");
        require(domain > 0 && approvedVkHash != bytes32(0) && approvedPolicy > 0 && approvedPolicy < FIELD
            && approvedSchema > 0 && approvedSchema < FIELD && approvedIssuer > 0 && approvedIssuer < FIELD, "Invalid trust configuration");
        owner = governance; bridge = IZkVerifyAggregation(aggregationBridge); registry = IAgentValidationRegistry(validationRegistry);
        domainId = domain; agentId = screeningAgentId; vkHash = approvedVkHash;
        policyHash = approvedPolicy; schemaHash = approvedSchema; issuerHash = approvedIssuer;
    }

    // requestURI serves these exact ABI-encoded bytes, without private inputs.
    function requestPayload(uint256[15] calldata signals) public view returns (bytes memory) {
        return abi.encode(block.chainid, address(registry), address(this), agentId, vkHash, signals);
    }
    function requestHash(uint256[15] calldata signals) public view returns (bytes32) {
        return keccak256(requestPayload(signals));
    }
    function statementLeaf(uint256[15] calldata signals) public view returns (bytes32) {
        bytes memory publicInputs = new bytes(15 * 32);
        for (uint256 i; i < 15; ++i) {
            require(signals[i] < FIELD, "Noncanonical field");
            // zkVerify's Groth16 BN254 scalar encoding is little-endian, 32 bytes.
            for (uint256 j; j < 32; ++j) publicInputs[i * 32 + j] = bytes1(uint8(signals[i] >> (j * 8)));
        }
        return keccak256(abi.encodePacked(PROVING_SYSTEM, vkHash, VERSION, keccak256(publicInputs)));
    }

    function certify(uint256[15] calldata signals, uint256 aggregationId, bytes32[] calldata merklePath, uint256 leafCount, uint256 index) external {
        require(!entered, "Reentrant validation");
        entered = true;
        require(enabled && signals[0] == 1 && signals[1] != 0 && !revoked[signals[1]], "Inactive credential");
        require(signals[2] == policyHash && signals[3] == schemaHash && signals[4] == issuerHash, "Unapproved policy/issuer");
        require(signals[11] == block.chainid && signals[12] == agentId && signals[13] == uint256(uint160(address(this))), "Wrong validation destination");
        require(signals[9] <= block.timestamp && signals[10] > block.timestamp && signals[10] <= type(uint64).max
            && signals[10] == signals[9] + 365 days, "Invalid credential lifetime");
        require(leafCount > 0 && index < leafCount, "Invalid aggregation path");
        bytes32 hash = requestHash(signals);
        (address validator, uint256 requestedAgent,,,,) = registry.getValidationStatus(hash);
        require(validator == address(this) && requestedAgent == agentId, "No matching agent request");
        require(certifications[signals[1]].requestHash == bytes32(0), "Already validated");
        bytes32 leaf = statementLeaf(signals);
        require(bridge.verifyProofAggregation(domainId, aggregationId, leaf, merklePath, leafCount, index), "Invalid zkVerify receipt");
        certifications[signals[1]] = Certification(hash, uint64(signals[10]));
        registry.validationResponse(hash, 100, "", leaf, "screening-credential-valid");
        emit Certified(signals[1], hash, signals[10]);
        entered = false;
    }
    function isCertified(uint256 commitment) external view returns (bool) {
        Certification memory certification = certifications[commitment];
        return enabled && !revoked[commitment] && certification.requestHash != bytes32(0) && certification.expiresAt > block.timestamp;
    }
    function revoke(uint256 commitment) external {
        require(msg.sender == owner, "Governance only");
        revoked[commitment] = true;
        emit Revoked(commitment);
    }
    function syncRevocation(uint256 commitment) external {
        require(revoked[commitment], "Not revoked");
        bytes32 hash = certifications[commitment].requestHash;
        require(hash != bytes32(0), "No validation record");
        registry.validationResponse(hash, 0, "", bytes32(0), "screening-credential-revoked");
    }
    function setEnabled(bool value) external {
        require(msg.sender == owner, "Governance only");
        enabled = value;
        emit Enabled(value);
    }
}
