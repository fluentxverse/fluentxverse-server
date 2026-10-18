use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sha3::{Digest, Keccak256};

pub const PROTOCOL: &str = "fluentxverse.review-tally.v1";
pub const TOPICS: [&str; 6] = [
    "connection",
    "feedback",
    "corrections",
    "pace",
    "difficulty",
    "engagement",
];
pub const JOURNAL_WORDS: usize = 31;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptedReview {
    pub nullifier: String,
    pub message_hash: String,
    pub statement: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub chain_id: u64,
    pub registry: String,
    pub group_id: String,
    pub scope_hash: String,
    pub root: String,
    pub review_vk: String,
    pub closes_at: u64,
    pub block_number: u64,
    pub block_hash: String,
    pub block_timestamp: u64,
    pub accepted: Vec<AcceptedReview>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Content {
    pub rating: u32,
    pub positive: Vec<String>,
    pub improvement: Vec<String>,
    pub salt: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub snapshot: Snapshot,
    pub contents: Vec<Content>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub total: u32,
    pub rating_sum: u32,
    pub distribution: [u32; 5],
    pub positive: [u32; 6],
    pub improvement: [u32; 6],
}

pub fn keccak(bytes: &[u8]) -> [u8; 32] {
    Keccak256::digest(bytes).into()
}
pub fn word(value: u64) -> [u8; 32] {
    let mut out = [0; 32];
    out[24..].copy_from_slice(&value.to_be_bytes());
    out
}
pub fn bytes32(value: &str) -> Result<[u8; 32], &'static str> {
    if value.len() != 66
        || !value.starts_with("0x")
        || value[2..]
            .bytes()
            .any(|b| !b.is_ascii_digit() && !(b'a'..=b'f').contains(&b))
    {
        return Err("noncanonical bytes32");
    }
    hex::decode(&value[2..])
        .map_err(|_| "invalid hex")?
        .try_into()
        .map_err(|_| "invalid word")
}
fn field(value: &str, nonzero: bool) -> Result<[u8; 32], &'static str> {
    let bytes = bytes32(value)?;
    let limit = bytes32("0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001")?;
    if bytes >= limit || (nonzero && bytes == [0; 32]) {
        return Err("noncanonical field");
    }
    Ok(bytes)
}
pub fn context(snapshot: &Snapshot) -> Result<Vec<[u8; 32]>, &'static str> {
    if snapshot.chain_id != 2651420
        || snapshot.block_number == 0
        || snapshot.block_timestamp < snapshot.closes_at
        || snapshot.accepted.len() < 5
        || snapshot.accepted.len() > 256
    {
        return Err("invalid closed snapshot");
    }
    if snapshot.registry.len() != 42 || !snapshot.registry.starts_with("0x") {
        return Err("invalid registry");
    }
    let address = bytes32(&format!("0x{}{}", "0".repeat(24), &snapshot.registry[2..]))?;
    if address == [0; 32] {
        return Err("invalid registry");
    }
    let group = bytes32(&snapshot.group_id)?;
    let vk = bytes32(&snapshot.review_vk)?;
    let block_hash = bytes32(&snapshot.block_hash)?;
    if group == [0; 32] || vk == [0; 32] || block_hash == [0; 32] {
        return Err("empty binding");
    }
    Ok(vec![
        keccak(PROTOCOL.as_bytes()),
        word(snapshot.chain_id),
        address,
        group,
        field(&snapshot.scope_hash, true)?,
        field(&snapshot.root, true)?,
        vk,
        word(snapshot.closes_at),
        word(snapshot.block_number),
        block_hash,
        word(snapshot.block_timestamp),
    ])
}
pub fn manifest(snapshot: &Snapshot) -> Result<[u8; 32], &'static str> {
    let mut data: Vec<u8> = context(snapshot)?.into_iter().flatten().collect();
    data.extend(word(snapshot.accepted.len() as u64));
    let mut previous = [0; 32];
    for item in &snapshot.accepted {
        let nullifier = field(&item.nullifier, true)?;
        if nullifier <= previous {
            return Err("unordered or duplicate nullifier");
        }
        previous = nullifier;
        let message = field(&item.message_hash, false)?;
        let statement = bytes32(&item.statement)?;
        let mut signals = Vec::new();
        for mut value in [
            field(&snapshot.root, true)?,
            nullifier,
            message,
            field(&snapshot.scope_hash, true)?,
        ] {
            value.reverse();
            signals.extend(value);
        }
        let mut leaf = Vec::new();
        leaf.extend(keccak(b"groth16"));
        leaf.extend(bytes32(&snapshot.review_vk)?);
        leaf.extend(Sha256::digest(b""));
        leaf.extend(keccak(&signals));
        if keccak(&leaf) != statement {
            return Err("review statement mismatch");
        }
        data.extend(nullifier);
        data.extend(message);
        data.extend(statement);
    }
    Ok(keccak(&data))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Message<'a> {
    protocol: &'a str,
    group_id: &'a str,
    rating: u32,
    positive: &'a Vec<String>,
    improvement: &'a Vec<String>,
    salt: &'a str,
}
pub fn message_hash(group: &str, content: &Content) -> Result<[u8; 32], &'static str> {
    if !(1..=5).contains(&content.rating)
        || content.salt.len() != 64
        || content
            .salt
            .bytes()
            .any(|b| !b.is_ascii_digit() && !(b'a'..=b'f').contains(&b))
    {
        return Err("invalid content");
    }
    for (items, positive) in [(&content.positive, true), (&content.improvement, false)] {
        if items.len() > 6
            || items.windows(2).any(|w| w[0] >= w[1])
            || items
                .iter()
                .any(|v| !TOPICS.contains(&v.as_str()) || (positive && v == "engagement"))
        {
            return Err("invalid topics");
        }
    }
    if content
        .positive
        .iter()
        .any(|v| content.improvement.contains(v))
    {
        return Err("conflicting topics");
    }
    let json = serde_json::to_vec(&Message {
        protocol: "fluentxverse.anonymous-reviews.v1",
        group_id: group,
        rating: content.rating,
        positive: &content.positive,
        improvement: &content.improvement,
        salt: &content.salt,
    })
    .map_err(|_| "encoding failed")?;
    let message = keccak(&json);
    // Semaphore hashes the full JSON commitment as a big-endian uint256, then truncates eight bits.
    let digest = keccak(&message);
    let mut result = [0; 32];
    result[1..].copy_from_slice(&digest[..31]);
    Ok(result)
}
pub fn tally(input: &Input) -> Result<(Totals, Vec<u8>), &'static str> {
    let commitment = manifest(&input.snapshot)?;
    if input.contents.len() != input.snapshot.accepted.len() {
        return Err("incomplete content set");
    }
    let mut totals = Totals {
        total: input.contents.len() as u32,
        rating_sum: 0,
        distribution: [0; 5],
        positive: [0; 6],
        improvement: [0; 6],
    };
    for (item, content) in input.snapshot.accepted.iter().zip(&input.contents) {
        if message_hash(&input.snapshot.group_id, content)? != bytes32(&item.message_hash)? {
            return Err("content commitment mismatch");
        }
        totals.rating_sum += content.rating;
        totals.distribution[(content.rating - 1) as usize] += 1;
        for (i, topic) in TOPICS.iter().enumerate() {
            totals.positive[i] += content.positive.iter().any(|v| v == topic) as u32;
            totals.improvement[i] += content.improvement.iter().any(|v| v == topic) as u32;
        }
    }
    let mut words = context(&input.snapshot)?;
    words.push(commitment);
    for value in [totals.total, totals.rating_sum]
        .into_iter()
        .chain(totals.distribution)
        .chain(totals.positive)
        .chain(totals.improvement)
    {
        words.push(word(value as u64));
    }
    assert_eq!(words.len(), JOURNAL_WORDS);
    Ok((totals, words.into_iter().flatten().collect()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn topic_policy_and_zero_knowledge_output() {
        let good = Content {
            rating: 5,
            positive: vec!["feedback".into()],
            improvement: vec!["connection".into()],
            salt: "ab".repeat(32),
        };
        assert!(message_hash(&format!("0x{}", "01".repeat(32)), &good).is_ok());
        let mut bad = good.clone();
        bad.positive.push("feedback".into());
        assert!(message_hash("group", &bad).is_err());
        bad = good.clone();
        bad.positive.push("engagement".into());
        assert!(message_hash("group", &bad).is_err());
        bad = good.clone();
        bad.rating = 0;
        assert!(message_hash("group", &bad).is_err());
        assert!(bytes32(&format!("0x{}", "AA".repeat(32))).is_err());
    }
}
