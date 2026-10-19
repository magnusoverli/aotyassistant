/** Compatibility exports for Music Assistant call sites; infrastructure is provider-neutral. */
export { operation as maOperation, remaining as maRemaining, operationSignal as maSignal,
  budget as maBudget, background as maBackground, timing as maTiming, stage as maStage } from './operation.js';
