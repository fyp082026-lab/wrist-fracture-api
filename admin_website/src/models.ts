/**
 * What is known about each AI model from its training run (the files in
 * "ai data/Archive" next to this repo), plus review notes. Live numbers come
 * from the server (/admin/api/models/{model}/stats); these do not change
 * unless a model is retrained.
 *
 * FLOW: MODELS and MODEL_ORDER are read by App.tsx (sidebar and page titles)
 * and AiModel.tsx (the content of each AI model page).
 */

export type ModelId = 'fracture' | 'bone_age';

export interface Metric {
  label: string;
  value: string;
  sub?: string;
}

export interface ModelCard {
  id: ModelId;
  name: string;
  module: string;
  architecture: string;
  purpose: string;
  dataset: string;
  training: string[];
  metricsTitle: string;
  metrics: Metric[];
  breakdownTitle: string;
  breakdown: { label: string; value: string; note?: string }[];
  limitations: string[];
  suggestions: { title: string; body: string }[];
}

export const MODELS: Record<ModelId, ModelCard> = {
  fracture: {
    id: 'fracture',
    name: 'Fracture detection',
    module: 'Module B',
    architecture: 'YOLOv8m object detector',
    purpose: 'Finds possible fractures on a wrist X-ray and draws a box with a confidence score around each one.',
    dataset: 'GRAZPEDWRI-DX: pediatric wrist trauma X-rays from Graz, Austria, labelled with 9 classes. Only the "fracture" class is used by the app.',
    training: [
      'Started from yolov8m.pt, image size 640 px (the server uses the same size). Kaggle notebook splintered2026/yolov8m-wrist-fracture.',
      'Split by patient (70% train, 20% validation, 10% test, seed 42), so no patient is in two splits.',
      '100 epochs planned; the 8.5-hour limit stopped it at epoch 67. Validation mAP peaked around epoch 27 and then slowly fell, so the best weights come from there.',
      'The app counts a fracture when the model reports it with at least 25% confidence, and labels findings under 65% "lower confidence". Both cut-offs were checked on 5,924 X-rays (Kaggle notebook splintered2026/yolov8m-confidence-tuning; model_evaluation/yolo_confidence_thresholds in the repository).',
    ],
    metricsTitle: 'Accuracy on the held-out test set (fracture class: 1,938 X-rays, 1,575 fractures)',
    metrics: [
      { label: 'mAP@0.5', value: '0.936', sub: 'mAP@0.5:0.95 0.551' },
      { label: 'Precision', value: '88.4%', sub: 'of its fracture boxes were real fractures' },
      { label: 'Recall', value: '90.4%', sub: 'of real fractures it found' },
      { label: 'All 9 classes', value: '0.593', sub: 'mAP@0.5, incl. rare classes' },
    ],
    breakdownTitle: 'What the app reports per X-ray (test set, 1,938 X-rays, 25% cut-off)',
    breakdown: [
      { label: 'Fractures caught', value: '96.9%', note: '1,171 of 1,208 X-rays with a fracture (37 missed)' },
      { label: 'Normal X-rays cleared', value: '91.4%', note: '667 of 730 (63 false alarms)' },
      { label: '"Fracture suggested" right', value: '94.9%', note: 'positive predictive value' },
      { label: '"No fracture" right', value: '94.7%', note: 'negative predictive value' },
      { label: 'Findings 65% and above', value: '97.9% real', note: '91% of all findings' },
      { label: 'Findings 25-65%', value: '65% real', note: 'shown as "lower confidence": about 1 in 3 is a false alarm' },
    ],
    limitations: [
      'Trained on one hospital\'s images (Graz). Performance on other hospitals\' X-ray machines is not measured yet.',
      'It finds where a fracture may be, not what kind (growth plate or shaft); that is Module D.',
    ],
    suggestions: [
      {
        title: 'Use it as a screening aid',
        body: 'It finds about 9 in 10 fractures, and false alarms are its main weakness. A doctor should always look at the boxes on the image before trusting a "fracture suggested" result.',
      },
      {
        title: 'Keep the 25% detection cut-off',
        body: 'Chosen on the validation set and checked on the test set: per X-ray, F1 is 0.959 at 25%, the same as the best cut-off (0.958 at 33%). Raising it to 41% would miss 17 more fractures to avoid 15 false alarms, and for a screening aid a missed fracture matters more.',
      },
      {
        title: 'Keep the 65% review label',
        body: 'Findings scored 65% or more are real fractures 97.9% of the time; findings between 25% and 65% only 65% of the time. The label appears on fewer than 1 in 10 findings, exactly where a second look is needed.',
      },
      {
        title: 'Only use original X-rays',
        body: 'The app now refuses images under 512 px. Photos of a screen or a printed film also lower accuracy; export the original image from the X-ray system where possible.',
      },
    ],
  },

  bone_age: {
    id: 'bone_age',
    name: 'Bone age',
    module: 'Module C',
    architecture: 'EfficientNet-B3 regression (X-ray + sex)',
    purpose: 'Estimates skeletal age in months from the X-ray and the patient\'s sex. The patient\'s real age is only shown next to it for comparison.',
    dataset: 'RSNA Pediatric Bone Age: hand X-rays with expert bone-age labels, 15 to 228 months in the test set.',
    training: [
      'EfficientNet-B3 (ImageNet weights), 1-channel input, 384 × 384 px.',
      'Pre-processing: 1st-99th percentile contrast stretch, letterbox to 384 px (the server uses the identical code).',
      'Sex is fed to the model (male 1, female 0) and joined with the image features before the output layer.',
    ],
    metricsTitle: 'Accuracy on the test set (1,262 X-rays)',
    metrics: [
      { label: 'Mean absolute error', value: '6.9 months', sub: 'median 5.4 months' },
      { label: 'Within 12 months', value: '83.5%', sub: '54.9% within 6, 98.3% within 24' },
      { label: 'R²', value: '0.95', sub: 'RMSE 9.2 months' },
      { label: 'Bias', value: '+0.5 months', sub: 'no systematic over- or under-estimate' },
    ],
    breakdownTitle: 'Error by age group and sex (mean absolute error)',
    breakdown: [
      { label: '0-5 years', value: '7.2 months', note: '85 X-rays' },
      { label: '5-10 years', value: '8.1 months', note: '350 X-rays (weakest group)' },
      { label: '10-15 years', value: '6.3 months', note: '718 X-rays' },
      { label: '15-19 years', value: '6.5 months', note: '109 X-rays' },
      { label: 'Boys', value: '6.7 months', note: '693 X-rays' },
      { label: 'Girls', value: '7.1 months', note: '569 X-rays' },
    ],
    limitations: [
      'Trained on whole-hand X-rays. A wrist-only X-ray shows fewer of the bones the model learned from.',
      'The RSNA images come from US hospitals; accuracy elsewhere is not measured yet.',
      'Few very young children: only 85 test X-rays were under 5 years.',
    ],
    suggestions: [
      {
        title: 'Use a whole-hand X-ray for bone age',
        body: 'This is the most important point: the model learned from full-hand images, while the fracture model uses wrist images. For "Bone age" scans, include the whole hand where possible, or treat estimates from wrist-only images with caution.',
      },
      {
        title: 'Check the sex is entered correctly',
        body: 'Sex is an input to the model, so a wrong entry changes the estimate. The same X-ray with the same sex always gives the same answer; the patient\'s age is not used.',
      },
      {
        title: 'A gap from real age is not always an error',
        body: 'Bone age can genuinely differ from real age. A gap of more than about 2 years deserves a second look: wrong age or sex entered, wrong type of image, or a real growth difference for a doctor to assess.',
      },
      {
        title: 'Be most careful between 5 and 10 years',
        body: 'This age group has the largest error (8.1 months). If you retrain, more X-rays of young children would help.',
      },
    ],
  },
};

export const MODEL_ORDER: ModelId[] = ['fracture', 'bone_age'];
