use std::io::Read;
fn main() {
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(1_048_577)
        .read_to_end(&mut bytes)
        .unwrap();
    if bytes.len() > 1_048_576 {
        std::process::exit(1);
    }
    let result = serde_json::from_slice::<review_tally_core::Input>(&bytes)
        .ok()
        .and_then(|input| review_tally_core::tally(&input).ok());
    match result {
        Some((totals, journal)) => println!(
            "{}",
            serde_json::json!({"totals":totals,"journal":format!("0x{}",hex::encode(journal))})
        ),
        None => {
            eprintln!("Invalid synthetic tally input");
            std::process::exit(1);
        }
    }
}
