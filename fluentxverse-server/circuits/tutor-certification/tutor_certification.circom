pragma circom 2.1.6;

include "poseidon.circom";
include "eddsaposeidon.circom";

template AssertBit() {
  signal input in;
  in * (in - 1) === 0;
}

template TutorCertification() {
  signal input writtenScore;
  signal input speakingScore;
  signal input profileApproved;
  signal input interviewPassed;

  // Private subject commitment inputs.
  signal input subjectHash;
  signal input credentialNonce;

  // FluentXverse issuer EdDSA-Poseidon signature over the credential message.
  signal input signatureR8x;
  signal input signatureR8y;
  signal input signatureS;

  // Public inputs.
  signal input credentialCommitment;
  signal input credentialTypeHash;
  signal input schemaVersionHash;
  signal input issuerHash;
  signal input issuerAx;
  signal input issuerAy;
  signal input assessmentRoot;

  signal output valid;

  component writtenBelowThreshold = LessThan(8);
  writtenBelowThreshold.in[0] <== writtenScore;
  writtenBelowThreshold.in[1] <== 90;
  writtenBelowThreshold.out === 0;

  component speakingBelowThreshold = LessThan(8);
  speakingBelowThreshold.in[0] <== speakingScore;
  speakingBelowThreshold.in[1] <== 85;
  speakingBelowThreshold.out === 0;

  component profileBit = AssertBit();
  profileBit.in <== profileApproved;
  profileApproved === 1;

  component interviewBit = AssertBit();
  interviewBit.in <== interviewPassed;
  interviewPassed === 1;

  component commitmentHash = Poseidon(2);
  commitmentHash.inputs[0] <== subjectHash;
  commitmentHash.inputs[1] <== credentialNonce;
  credentialCommitment === commitmentHash.out;

  component issuerHashCheck = Poseidon(2);
  issuerHashCheck.inputs[0] <== issuerAx;
  issuerHashCheck.inputs[1] <== issuerAy;
  issuerHash === issuerHashCheck.out;

  component credentialMessage = Poseidon(9);
  credentialMessage.inputs[0] <== writtenScore;
  credentialMessage.inputs[1] <== speakingScore;
  credentialMessage.inputs[2] <== profileApproved;
  credentialMessage.inputs[3] <== interviewPassed;
  credentialMessage.inputs[4] <== credentialCommitment;
  credentialMessage.inputs[5] <== credentialTypeHash;
  credentialMessage.inputs[6] <== schemaVersionHash;
  credentialMessage.inputs[7] <== issuerHash;
  credentialMessage.inputs[8] <== assessmentRoot;

  component issuerSignature = EdDSAPoseidonVerifier();
  issuerSignature.enabled <== 1;
  issuerSignature.Ax <== issuerAx;
  issuerSignature.Ay <== issuerAy;
  issuerSignature.R8x <== signatureR8x;
  issuerSignature.R8y <== signatureR8y;
  issuerSignature.S <== signatureS;
  issuerSignature.M <== credentialMessage.out;

  valid <== 1;
}

component main {
  public [
    credentialCommitment,
    credentialTypeHash,
    schemaVersionHash,
    issuerHash,
    issuerAx,
    issuerAy,
    assessmentRoot
  ]
} = TutorCertification();
