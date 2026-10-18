use review_tally_methods::{REVIEW_TALLY_ELF, REVIEW_TALLY_ID};
use risc0_zkvm::{Executor, ExecutorEnv, InnerReceipt, LocalProver, Prover, ProverOpts, Receipt};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ZkVerifyProof {
    inner: InnerReceipt,
}

fn verify_wire(
    proof: &[u8],
    image: &str,
    journal: &[u8],
) -> Result<(), Box<dyn std::error::Error>> {
    let decoded: risc0_verifier::Proof = ciborium::from_reader(proof)?;
    let image_bytes: [u8; 32] = hex::decode(image)?
        .try_into()
        .map_err(|_| "invalid image")?;
    risc0_verifier::verify(
        &risc0_verifier::v2_3(),
        image_bytes.into(),
        decoded,
        risc0_verifier::Journal::new(journal.to_vec()),
    )
    .map_err(|_| "zkVerify verifier rejected receipt")?;
    Ok(())
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "metadata".into());
    let id = risc0_zkvm::sha::Digest::from(REVIEW_TALLY_ID).to_string();
    if mode == "metadata" {
        println!(
            "{}",
            serde_json::json!({"imageId": format!("0x{id}"), "elfSha256": hex::encode(Sha256::digest(REVIEW_TALLY_ELF)), "version": "V2_3"})
        );
        return Ok(());
    }
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("input too large".into());
    }
    if mode == "verify" {
        let value: serde_json::Value = serde_json::from_slice(&bytes)?;
        let raw = hex::decode(
            value["proof"]
                .as_str()
                .ok_or("missing proof")?
                .strip_prefix("0x")
                .ok_or("invalid proof")?,
        )?;
        let mut reader = raw.as_slice();
        let wire: ZkVerifyProof = ciborium::from_reader(&mut reader)?;
        if !reader.is_empty() || matches!(wire.inner, InnerReceipt::Fake(_)) {
            return Err("invalid receipt".into());
        }
        let journal = hex::decode(
            value["publicSignals"]
                .as_str()
                .ok_or("missing journal")?
                .strip_prefix("0x")
                .ok_or("invalid journal")?,
        )?;
        verify_wire(&raw, &id, &journal)?;
        let receipt = Receipt::new(wire.inner, journal);
        receipt.verify(REVIEW_TALLY_ID)?;
        println!("{{\"verified\":true}}");
        return Ok(());
    }
    if mode != "prove" && mode != "execute" {
        return Err("unknown mode".into());
    }
    let input: review_tally_core::Input = serde_json::from_slice(&bytes)?;
    let (_, expected) = review_tally_core::tally(&input)?;
    let env = ExecutorEnv::builder()
        .write(&input)?
        .session_limit(Some(1 << 28))
        .build()?;
    let prover = LocalProver::new("review-tally-local");
    if mode == "execute" {
        let session = prover.execute(env, REVIEW_TALLY_ELF)?;
        if session.journal.bytes != expected {
            return Err("journal mismatch".into());
        }
        println!(
            "{}",
            serde_json::json!({"publicSignals": format!("0x{}", hex::encode(expected)), "imageId": format!("0x{id}"), "executedOnly": true})
        );
        return Ok(());
    }
    let receipt = prover
        .prove_with_opts(env, REVIEW_TALLY_ELF, &ProverOpts::composite())?
        .receipt;
    if matches!(receipt.inner, InnerReceipt::Fake(_)) {
        return Err("fake receipt forbidden".into());
    }
    receipt.verify(REVIEW_TALLY_ID)?;
    if receipt.journal.bytes != expected {
        return Err("journal mismatch".into());
    }
    let mut proof = Vec::new();
    ciborium::into_writer(
        &ZkVerifyProof {
            inner: receipt.inner,
        },
        &mut proof,
    )?;
    verify_wire(&proof, &id, &receipt.journal.bytes)?;
    let output = serde_json::json!({"proof": format!("0x{}", hex::encode(proof)), "publicSignals": format!("0x{}", hex::encode(receipt.journal.bytes)),
        "vk": format!("0x{id}"), "version": "V2_3", "proofSystem": "risc0", "localVerified": true});
    std::io::stdout().write_all(serde_json::to_string(&output)?.as_bytes())?;
    Ok(())
}
fn main() {
    if run().is_err() {
        eprintln!("Tally prover failed; private witness and internal diagnostics withheld");
        std::process::exit(1);
    }
}
