import { DocumentFailure } from '../../domain/DocumentFailure';
import { ProjectFailure } from '../../domain/ProjectFailure';
import { AnalysisFailure } from '../../domain/requirements/AnalysisFailure';
import { ModelFailure } from '../models/ModelFailure';

export function safeAnalysisFailure(error: unknown): AnalysisFailure | DocumentFailure | ProjectFailure | ModelFailure {
  if (error instanceof ModelFailure && error.code === 'CANCELLED') return new AnalysisFailure('CANCELLED');
  return error instanceof AnalysisFailure || error instanceof DocumentFailure || error instanceof ProjectFailure || error instanceof ModelFailure
    ? error : new AnalysisFailure('PROVIDER');
}
