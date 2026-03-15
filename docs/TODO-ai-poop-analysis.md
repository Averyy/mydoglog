# TODO: AI Poop Photo Analysis

**Priority: Lowest** — cool feature, significant effort. Build after weight tracking and custom food entry are done.

## Goal

Photograph a dog's stool and get an automated Purina 1-7 fecal score prediction. Reduces subjectivity in manual scoring and makes logging faster (snap photo → confirm/adjust score → save).

## Approach

Train a custom image classification model using the same pipeline as `~/Code/wafer/training/recaptcha/`. Wafer has a complete PyTorch → ONNX training pipeline with MPS (Apple Silicon) support, data collection tooling, dedup, and Hugging Face model hosting.

### Key Reference Files in wafer

| File | What to reuse |
|------|---------------|
| `training/recaptcha/train_mps.py` | Training loop, EfficientNet backbone, augmentation, MPS optimization, checkpoint resume, early stopping |
| `training/recaptcha/export.py` | ONNX export with dynamic batch axes |
| `training/recaptcha/collect.py` | Data collection patterns, dHash+SHA256 dedup |
| `training/recaptcha/dedup.py` | Offline deduplication |
| `wafer/browser/_recaptcha_grid.py` | Runtime ONNX inference pattern, lazy-load from HuggingFace, thread-safe session |

### Model Architecture

- **Type:** 7-class image classifier (Purina scores 1-7)
- **Backbone:** EfficientNet-B0 via timm (same as wafer CLS model)
- **Input:** (B, 3, 224, 224) normalized to ImageNet stats
- **Output:** (B, 7) logits → softmax → predicted score
- **Export:** ONNX (opset 17), ~21 MB
- **Hosting:** Hugging Face (`Averyyyyyy/mydoglog-models`)

### Data Collection

- Add photo capture to Quick Poop flow (optional — camera button alongside score picker)
- Store photos locally with user-selected Purina score as ground truth label
- Dataset structure: `datasets/poop/train/{1,2,3,4,5,6,7}/`
- Dedup via dHash64 + pixel SHA256 (wafer pattern)
- Need ~500+ labeled images per score class for reasonable accuracy (3,500+ total minimum)
- Consider: public veterinary stool image datasets as supplementary training data

### Training

- Adapt `train_mps.py` with `NUM_CLASSES = 7`
- Augmentation critical for phone camera variation:
  - RandomRotation, RandomAffine (angle/perspective)
  - RandomResizedCrop (zoom variation)
  - GaussianBlur (motion blur, focus issues)
  - ColorJitter (lighting, phone sensor differences)
- Loss: CrossEntropyLoss (or ordinal regression — scores are ordered, not categorical)
- Consider ordinal encoding: predict P(score ≥ k) for k=2..7, which respects the ordering

### Inference

- Client-side: capture photo, upload to API
- Server-side: ONNX Runtime (CPU provider), lazy-load model from HuggingFace
- Return: predicted score + confidence + top-3 probabilities
- UI: show predicted score, let user confirm or adjust before saving

### Privacy

- Photos stored per-user, not shared
- Model trained on aggregated/anonymized data only
- Option to opt-out of contributing photos to training dataset

## Phases

1. **Photo capture** — add optional camera button to Quick Poop flow, store photos with manual scores (builds dataset)
2. **Model training** — once enough labeled data exists (~3,500+ images), train and evaluate
3. **Inference integration** — add prediction to Quick Poop flow (photo → suggested score → confirm)

## Notes

- Start with Phase 1 immediately (collecting labeled data costs nothing and enables everything else)
- Score distribution will be skewed (most dogs poop 2-4 most days) — may need oversampling of extreme scores
- Ordinal regression may outperform flat classification since scores are ordered
- Could also explore regression (predict continuous 1.0-7.0) but classification is simpler to start
