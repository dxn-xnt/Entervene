from pathlib import Path

import pytest

from scripts.provision_current_term_demo_artifacts import MODEL_NAME, provision, verify_source
from app.services.prediction import RegisterCorrectedCurrentTermModel as registration


def test_trusted_local_bundle_verifies():
    source = Path(__file__).resolve().parents[1] / "data"
    if not (source / "models" / f"{MODEL_NAME}.joblib").is_file():
        pytest.skip("Trusted local artifact bundle is not provisioned.")
    assert len(verify_source(source)) == 5


def test_wrong_artifact_never_reaches_runtime(tmp_path):
    source = tmp_path / "source"
    destination = tmp_path / "runtime"
    candidate = source / "models" / f"{MODEL_NAME}.joblib"
    candidate.parent.mkdir(parents=True)
    candidate.write_bytes(b"wrong artifact")
    with pytest.raises(ValueError, match="checksum mismatch"):
        provision(source, destination)
    assert not destination.exists()


def test_missing_artifact_never_reaches_runtime(tmp_path):
    destination = tmp_path / "runtime"
    with pytest.raises(ValueError, match="bundle file missing"):
        provision(tmp_path / "empty", destination)
    assert not destination.exists()


def test_registration_reports_missing_or_wrong_corrected_artifact(tmp_path, monkeypatch):
    candidate = tmp_path / f"{MODEL_NAME}.joblib"
    monkeypatch.setattr(registration, "artifact_path", lambda _name: candidate)
    with pytest.raises(ValueError, match="artifact missing"):
        registration.verified_corrected_package()
    candidate.write_bytes(b"wrong artifact")
    with pytest.raises(ValueError, match="checksum mismatch"):
        registration.verified_corrected_package()
