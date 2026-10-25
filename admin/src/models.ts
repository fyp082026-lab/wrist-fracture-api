/**
 * What is known about each AI model from its training run (the files in
 * "ai data/Archive" next to this repo), plus review notes. Live numbers come
 * from the server (/admin/api/models/{model}/stats); these do not change
 * unless a model is retrained.
 */

export type ModelId = 'fracture' | 'bone_age' | 'fusion';

export interface Metric {
  label: string;
  value: string;
  sub?: string;
}

export interface Figure {
  src: string;
  title: string;
  caption: string;
}

export interface ModelCard {
  id: ModelId;
  name: string;
  module: string;
  architecture: string;
  status: 'live' | 'not_trained';
  purpose: string;
  dataset: string;
  training: string[];
  metricsTitle: string;
  metrics: Metric[];
  breakdownTitle?: string;
  breakdown?: { label: string; value: string; note?: string }[];
  figures: Figure[];
  limitations: string[];
  suggestions: { title: string; body: string }[];
}

const FIG = (name: string) => `${import.meta.env.BASE_URL}charts/${name}`;

export const MODELS: Record<ModelId, ModelCard> = {
  fracture: {
    id: 'fracture',
    name: 'Fracture detection',
    module: 'Module B',
    architecture: 'YOLOv8m object detector',
    status: 'live',
    purpose: 'Finds possible fractures on a wrist X-ray and draws a box with a confidence score around each one.',
    dataset: 'GRAZPEDWRI-DX: pediatric wrist trauma X-rays from Graz, Austria, labelled with 9 classes. Only the "fracture" class is used by the app.',
    training: [
      'Started from yolov8m.pt, image size 640 px (the server uses the same size).',
      '100 epochs planned; training stopped at epoch 67, best weights from epoch 27.',
      'The app counts a fracture when the model reports it with at least 25% confidence.',
    ],
    metricsTitle: 'Accuracy on the validation set (fracture class)',
    metrics: [
      { label: 'mAP@0.5', value: '0.936', sub: 'area under the precision-recall curve' },
      { label: 'Recall', value: '98%', sub: 'real fractures it found (2% missed)' },
      { label: 'F1 score', value: '≈ 0.90', sub: 'at confidence 0.2 to 0.6' },
      { label: 'All 9 classes', value: '0.593', sub: 'mAP@0.5, incl. rare classes' },
    ],
    breakdownTitle: 'Where it goes wrong (normalised confusion matrix)',
    breakdown: [
      { label: 'Missed fractures', value: '2%', note: 'real fractures it called background' },
      { label: 'False alarms', value: '35%', note: 'of its detections on normal bone were labelled fracture' },
      { label: 'Bone lesion → fracture', value: '25%', note: 'other findings it mistook for fractures' },
      { label: 'Bone anomaly → fracture', value: '18%', note: '' },
    ],
    figures: [
      { src: FIG('fracture-pr-curve.png'), title: 'Precision-recall curve', caption: 'Validation set. Fracture (green) reaches mAP@0.5 0.936.' },
      { src: FIG('fracture-f1-curve.png'), title: 'F1-confidence curve', caption: 'Fracture (red) stays near F1 0.90 from confidence 0.2 to 0.6.' },
      { src: FIG('fracture-confusion-matrix.png'), title: 'Confusion matrix (normalised)', caption: 'Columns are the true class; 0.98 of fractures were detected.' },
    ],
    limitations: [
      'Trained on one hospital\'s images (Graz). Performance on other hospitals\' X-ray machines is not measured yet.',
      'These figures are on the validation set used during training, not on a separate held-out test set.',
      'It finds where a fracture may be, not what kind (growth plate or shaft); that is Module D.',
    ],
    suggestions: [
      {
        title: 'Use it as a screening aid',
        body: 'With 98% recall it rarely misses a fracture, but false alarms are its main weakness. A doctor should always look at the boxes on the image before trusting a "fracture suggested" result.',
      },
      {
        title: 'Review the 65% "lower confidence" cut-off after real use',
        body: 'The model scores most real fractures between 40% and 75%, and its best F1 is near 40%. The current 65% cut-off is deliberately cautious, so many correct findings will be flagged for review. Revisit it once there are real scans to compare.',
      },
      {
        title: 'Report a held-out test result',
        body: 'For the FYP report, run the model once on the GRAZPEDWRI-DX test split (model.val(split="test")) and report precision, recall, F1 and mAP for the fracture class from that run.',
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
    status: 'live',
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
    figures: [
      { src: FIG('bone-age-test-scatter.png'), title: 'Predicted vs true bone age', caption: 'Test set, 1,262 X-rays. Points close to the red line are accurate.' },
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

  fusion: {
    id: 'fusion',
    name: 'Fusion AI',
    module: 'Module D',
    architecture: 'Bone-age-aware fracture type classifier (CNN)',
    status: 'not_trained',
    purpose: 'Will decide whether a detected fracture is a growth-plate injury or a shaft fracture, using the fracture crop from YOLOv8 together with the bone age and sex.',
    dataset: 'Fracture crops from GRAZPEDWRI-DX, labelled growth plate or shaft by checking whether the fracture box overlaps the growth plate region; a doctor checks a subset.',
    training: [
      'Pipeline: EfficientNet bone age → YOLOv8 fracture box → crop → this classifier; only runs when a fracture is found.',
      'Bone age and sex are joined to the image features at the classifier head.',
      'Compare against the same model without bone age to show whether bone age helps.',
    ],
    metricsTitle: 'Accuracy',
    metrics: [],
    figures: [],
    limitations: ['Not trained yet, so it is not offered in the mobile app.'],
    suggestions: [
      {
        title: 'Prepare the labels first',
        body: 'Mark the distal radius and ulna growth plates on the GRAZPEDWRI-DX images, then label each fracture box by its overlap with them. Have a doctor confirm a sample (for example 100 crops).',
      },
      {
        title: 'Plan for the hand / wrist mismatch',
        body: 'Bone age was trained on whole-hand X-rays but fractures on wrist X-rays. Decide whether the fusion model uses the bone age estimate from the wrist image or the patient\'s real age, and test both.',
      },
      {
        title: 'Report the comparison',
        body: 'Train the classifier with and without bone age on the same split and report accuracy, F1 and a confusion matrix for both; that comparison is the main result of Module D.',
      },
    ],
  },
};

export const MODEL_ORDER: ModelId[] = ['fracture', 'bone_age', 'fusion'];
