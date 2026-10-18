#![no_main]
risc0_zkvm::guest::entry!(main);

fn main() {
    let input: review_tally_core::Input = risc0_zkvm::guest::env::read();
    let (_, journal) = review_tally_core::tally(&input).expect("invalid private tally witness");
    risc0_zkvm::guest::env::commit_slice(&journal);
}
