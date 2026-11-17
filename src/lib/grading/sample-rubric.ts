import type { Rubric } from "./schemas";

/** The built-in sample class test (also the feasibility-spike rubric). English only. */
export const SAMPLE_TITLE = "Class 9-10 Science & Maths practice test (spike)";

export const SAMPLE_RUBRIC: Rubric = {
  "questions": [
    {
      "q": 1,
      "type": "short",
      "marks": 2,
      "text": "What is photosynthesis? Write its balanced chemical equation.",
      "modelAnswer": "Photosynthesis is the process by which green plants make glucose (food) from carbon dioxide and water using light energy absorbed by chlorophyll, releasing oxygen. 6CO2 + 6H2O -> C6H12O6 + 6O2 (in the presence of light and chlorophyll).",
      "criteria": [
        {
          "id": "1a",
          "points": 1,
          "mustMention": "plants make food/glucose from CO2 and water using light energy (chlorophyll)"
        },
        {
          "id": "1b",
          "points": 1,
          "mustMention": "correct balanced equation 6CO2 + 6H2O -> C6H12O6 + 6O2"
        }
      ],
      "commonMisconceptions": [
        "plants get their food from the soil",
        "the oxygen released comes from carbon dioxide",
        "unbalanced equation"
      ]
    },
    {
      "q": 2,
      "type": "long",
      "marks": 4,
      "text": "Explain the difference between mitosis and meiosis.",
      "modelAnswer": "Mitosis is one division producing two genetically identical diploid daughter cells; it is used for growth and repair. Meiosis is two divisions producing four haploid cells with half the chromosome number; it forms gametes (sex cells). Meiosis creates genetic variation through crossing over; mitosis does not.",
      "criteria": [
        {
          "id": "2a",
          "points": 1,
          "mustMention": "number of divisions: mitosis one, meiosis two"
        },
        {
          "id": "2b",
          "points": 1,
          "mustMention": "daughter cells: mitosis 2 diploid / identical, meiosis 4 haploid / half chromosomes"
        },
        {
          "id": "2c",
          "points": 1,
          "mustMention": "purpose: mitosis growth and repair, meiosis gamete formation"
        },
        {
          "id": "2d",
          "points": 1,
          "mustMention": "genetic variation / crossing over in meiosis"
        }
      ],
      "commonMisconceptions": [
        "mitosis makes gametes",
        "meiosis is for growth",
        "both produce identical cells"
      ]
    },
    {
      "q": 3,
      "type": "math",
      "marks": 3,
      "text": "Solve 2x^2 - 7x + 3 = 0. Show all steps.",
      "modelAnswer": "2x^2 - 6x - x + 3 = 0 -> 2x(x - 3) - 1(x - 3) = 0 -> (2x - 1)(x - 3) = 0 -> x = 1/2 or x = 3. (Or quadratic formula: D = 49 - 24 = 25, x = (7 +/- 5)/4.)",
      "criteria": [
        {
          "id": "3a",
          "points": 1,
          "mustMention": "valid method set up (splitting the middle term or quadratic formula with a, b, c)",
          "ecf": true
        },
        {
          "id": "3b",
          "points": 1,
          "mustMention": "accurate intermediate: (2x-1)(x-3)=0 or discriminant = 25 (must be actually correct)",
          "ecf": false
        },
        {
          "id": "3c",
          "points": 1,
          "mustMention": "both roots found from the student's own factorisation or formula (error carried forward allowed); correct values x = 1/2 and x = 3",
          "ecf": true
        }
      ],
      "commonMisconceptions": [
        "sign error when splitting the middle term",
        "only one root given",
        "dividing by x and losing a root"
      ]
    },
    {
      "q": 4,
      "type": "diagram",
      "marks": 3,
      "text": "Draw a labelled diagram of a plant cell. Label any four parts.",
      "modelAnswer": "A rectangular cell with cell wall, cell membrane, nucleus, chloroplasts, a large central vacuole, cytoplasm, mitochondria.",
      "criteria": [
        {
          "id": "4a",
          "points": 1,
          "mustMention": "plant-cell structure: rigid rectangular outline with a cell wall and a large vacuole (not a round animal cell)"
        },
        {
          "id": "4b",
          "points": 2,
          "mustMention": "four correct labels (0.5 each) from: cell wall, cell membrane, nucleus, chloroplast, vacuole, cytoplasm, mitochondria"
        }
      ],
      "commonMisconceptions": [
        "draws an animal cell (no cell wall / chloroplast)",
        "labels pointing to the wrong part",
        "calls the cell wall the cell membrane"
      ]
    },
    {
      "q": 5,
      "type": "short",
      "marks": 2,
      "text": "State Newton's third law of motion and give one everyday example.",
      "modelAnswer": "For every action there is an equal and opposite reaction: forces come in pairs and act on two different bodies. Example: when you walk, your foot pushes the ground backward and the ground pushes you forward.",
      "criteria": [
        {
          "id": "5a",
          "points": 1,
          "mustMention": "every action has an equal and opposite reaction (a force pair acting on two different bodies)"
        },
        {
          "id": "5b",
          "points": 1,
          "mustMention": "a valid everyday example that names both forces"
        }
      ],
      "commonMisconceptions": [
        "action and reaction act on the same body and cancel out",
        "the heavier object exerts the bigger force"
      ]
    },
    {
      "q": 6,
      "type": "one_word",
      "marks": 1,
      "text": "Which organelle is called the powerhouse of the cell?",
      "modelAnswer": "Mitochondria",
      "criteria": [
        {
          "id": "6a",
          "points": 1,
          "mustMention": "mitochondria / mitochondrion"
        }
      ],
      "commonMisconceptions": [
        "nucleus",
        "chloroplast"
      ]
    }
  ]
};
