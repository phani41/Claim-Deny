"""Unit tests for PII/PHI Masking Engine (Presidio + Regex Fallback)."""

from unittest import TestCase
from app.pii_masker import mask_pii, _regex_mask_pii
import app.pii_masker as pm


class TestPiiMasker(TestCase):

    def test_presidio_primary_masking(self):
        sample = (
            "Patient Name: Rajesh Kumar, DOB: 12/04/1985. "
            "Contact: rajesh@hospital.org or phone +91 9876543210. "
            "Aadhaar: 1234 5678 9012, PAN: ABCDE1234F, IP: 192.168.1.1. "
            "Admitted with acute cholecystitis. Laparoscopic cholecystectomy performed."
        )
        res = mask_pii(sample)
        self.assertEqual(res.engine, "presidio")
        self.assertNotIn("rajesh@hospital.org", res.text)
        self.assertNotIn("9876543210", res.text)
        self.assertNotIn("1234 5678 9012", res.text)
        self.assertNotIn("ABCDE1234F", res.text)
        self.assertNotIn("192.168.1.1", res.text)
        # Verify clinical content is preserved
        self.assertIn("acute cholecystitis", res.text)
        self.assertIn("cholecystectomy", res.text)

    def test_regex_fallback_engine(self):
        sample = (
            "Patient Name: Ananya Sen, DOB: 05/11/1990. "
            "Email: ananya.sen@clinic.in, Phone: 9812345678. "
            "Aadhaar: 9876 5432 1098, PAN: XYZAB5678C. "
            "Treatment: Intravenous Ceftriaxone 1g."
        )
        # Directly test fallback engine
        res = _regex_mask_pii(sample)
        self.assertEqual(res.engine, "regex")
        self.assertIn("<EMAIL_ADDRESS>", res.text)
        self.assertIn("<PHONE_NUMBER>", res.text)
        self.assertIn("<AADHAAR_NUMBER>", res.text)
        self.assertIn("<PAN_NUMBER>", res.text)
        self.assertIn("<DOB>", res.text)
        self.assertIn("<PATIENT_NAME>", res.text)
        self.assertNotIn("ananya.sen@clinic.in", res.text)
        self.assertNotIn("9812345678", res.text)
        self.assertNotIn("9876 5432 1098", res.text)
        # Verify treatment is preserved
        self.assertIn("Intravenous Ceftriaxone", res.text)

    def test_simulated_presidio_failure_fallback(self):
        sample = "Patient: Sunita Rao, Email: sunita@example.com, Phone: 9876543210"
        original_init = pm._init_presidio
        try:
            # Force Presidio to simulate unavailable
            pm._init_presidio = lambda: (None, None)
            res = mask_pii(sample)
            self.assertEqual(res.engine, "regex")
            self.assertNotIn("sunita@example.com", res.text)
            self.assertNotIn("9876543210", res.text)
            self.assertIn("<EMAIL_ADDRESS>", res.text)
        finally:
            pm._init_presidio = original_init

    def test_empty_and_benign_text(self):
        empty_res = mask_pii("")
        self.assertEqual(empty_res.text, "")

        benign = "Normal sinus rhythm observed on ECG. No acute abnormalities."
        benign_res = mask_pii(benign)
        self.assertEqual(benign_res.text, benign)

