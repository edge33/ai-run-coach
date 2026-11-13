export class GarminError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'GarminError';
  }
}

type ContractIssue = { path: string; code: string; expected?: string; received?: string };

export class GarminContractError extends GarminError {
  readonly contract: string;
  readonly issues: ContractIssue[];

  constructor(contract: string, issues: ContractIssue[]) {
    super('GARMIN_CONTRACT_CHANGED');
    this.name = 'GarminContractError';
    this.contract = contract;
    this.issues = issues;
  }
}

export class GarminRateLimitError extends GarminError {
  readonly cooldownUntil: string | null;

  constructor(cooldownUntil: string | null) {
    super('HTTP_429');
    this.cooldownUntil = cooldownUntil;
  }
}
