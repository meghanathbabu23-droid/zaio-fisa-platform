const SCORE_GAP_THRESHOLD = 15;

export type AdvisoryFlag = {
  code: string;
  message: string;
  advisory: true;
};

export function computeAdvisoryFlags(input: {
  status: string;
  submitted: boolean;
  automatedScore: number | null;
  assessorScore: number | null;
}): AdvisoryFlag[] {
  const flags: AdvisoryFlag[] = [];

  if (input.submitted && input.automatedScore == null) {
    flags.push({
      code: "MISSING_AUTO_ASSESSMENT",
      message: "Practical submitted but no automated assessment is on record.",
      advisory: true,
    });
  }

  if (input.submitted && input.assessorScore == null) {
    flags.push({
      code: "INCOMPLETE_ASSESSOR_REVIEW",
      message: "Submission is in but assessor-approved score is not recorded yet.",
      advisory: true,
    });
  }

  if (
    input.automatedScore != null &&
    input.assessorScore != null &&
    Math.abs(input.automatedScore - input.assessorScore) >= SCORE_GAP_THRESHOLD
  ) {
    flags.push({
      code: "UNUSUAL_SCORE_GAP",
      message: `Automated (${input.automatedScore.toFixed(0)}%) and assessor-approved (${input.assessorScore.toFixed(0)}%) differ by ${Math.abs(input.automatedScore - input.assessorScore).toFixed(0)} points. Advisory only — marks are not changed automatically.`,
      advisory: true,
    });
  }

  return flags;
}
