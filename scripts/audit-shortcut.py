#!/usr/bin/env python3
"""Verify the actions in a signed Apple shortcut against its unsigned source."""

import argparse
import hashlib
import pathlib
import plistlib
import struct
import subprocess
import tempfile


def audit(expected, signed):
    source = plistlib.loads(expected.read_bytes())
    data = signed.read_bytes()
    if data[:4] != b"AEA1":
        raise ValueError("Expected an Apple signed archive.")
    length = struct.unpack_from("<I", data, 8)[0]
    certificate = plistlib.loads(data[12:12 + length])["SigningCertificateChain"][0]
    public = subprocess.run(
        ["openssl", "x509", "-inform", "DER", "-pubkey", "-noout"],
        input=certificate, capture_output=True, check=True,
    ).stdout
    der = subprocess.run(
        ["openssl", "pkey", "-pubin", "-outform", "DER"],
        input=public, capture_output=True, check=True,
    ).stdout
    key = der[-65:]
    if len(key) != 65 or key[0] != 4:
        raise ValueError("Expected an uncompressed P-256 public key.")
    with tempfile.TemporaryDirectory(prefix="shortcut-audit-") as directory:
        root = pathlib.Path(directory)
        archive = root / "shortcut.aar"
        extracted = root / "extracted"
        subprocess.run(
            ["aea", "decrypt", "-i", str(signed), "-o", str(archive),
             "-sign-pub-value", "hex:" + key.hex()], check=True,
        )
        subprocess.run(["aa", "extract", "-i", str(archive), "-d", str(extracted)], check=True)
        result = plistlib.loads((extracted / "Shortcut.wflow").read_bytes())
    expected_actions = source["WFWorkflowActions"]
    actual_actions = result["WFWorkflowActions"]
    if actual_actions != expected_actions:
        raise ValueError(
            f"Signed actions differ from source: expected {len(expected_actions)}, got {len(actual_actions)}."
        )
    network = sum(a["WFWorkflowActionIdentifier"] == "is.workflow.actions.downloadurl" for a in actual_actions)
    print(f"PASS: {len(actual_actions)} matching actions; {network} network actions; "
          f"SHA256 {hashlib.sha256(data).hexdigest()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected", type=pathlib.Path, required=True)
    parser.add_argument("--signed", type=pathlib.Path, required=True)
    args = parser.parse_args()
    audit(args.expected, args.signed)
