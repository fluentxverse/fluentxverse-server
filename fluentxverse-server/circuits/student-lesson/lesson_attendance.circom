pragma circom 2.1.6;

include "poseidon.circom";
include "eddsaposeidon.circom";

template LessonAttendance() {
  signal input bookingHash;
  signal input studentHash;
  signal input nonce;
  signal input attended;
  signal input lessonEnded;
  signal input signatureR8x;
  signal input signatureR8y;
  signal input signatureS;

  signal input commitment;
  signal input credentialType;
  signal input issuerAx;
  signal input issuerAy;

  attended === 1;
  lessonEnded === 1;

  component subject = Poseidon(3);
  subject.inputs[0] <== studentHash;
  subject.inputs[1] <== bookingHash;
  subject.inputs[2] <== nonce;
  commitment === subject.out;

  component message = Poseidon(4);
  message.inputs[0] <== bookingHash;
  message.inputs[1] <== attended;
  message.inputs[2] <== lessonEnded;
  message.inputs[3] <== commitment;

  component signedCredential = Poseidon(2);
  signedCredential.inputs[0] <== message.out;
  signedCredential.inputs[1] <== credentialType;

  component signature = EdDSAPoseidonVerifier();
  signature.enabled <== 1;
  signature.Ax <== issuerAx;
  signature.Ay <== issuerAy;
  signature.R8x <== signatureR8x;
  signature.R8y <== signatureR8y;
  signature.S <== signatureS;
  signature.M <== signedCredential.out;
}

component main {public [commitment, credentialType, issuerAx, issuerAy]} = LessonAttendance();
