import { PayloadFormat, TransformerErrorCode } from '../../common/enums.js';
import { TransformerException } from '../../common/exceptions.js';
import { isRecord } from '../../common/utils.js';
import type { CollectorInput } from '../../contracts/collectors.js';

/** Check the envelope supplied by another service before starting the workflow. */
export function receiveInput(value: unknown): CollectorInput {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.payload)) {
    throw new TransformerException(
      TransformerErrorCode.ValidationFailed,
      'Expected inputId, source and payload.',
    );
  }
  const { source, payload } = value;
  const nonEmpty = (text: unknown): text is string =>
    typeof text === 'string' && text.trim().length > 0 && text.length <= 256;
  if (
    !nonEmpty(value.inputId) ||
    !nonEmpty(source.id) ||
    !nonEmpty(source.version) ||
    !nonEmpty(source.platform)
  ) {
    throw new TransformerException(
      TransformerErrorCode.ValidationFailed,
      'Input and source identifiers must be non-empty strings.',
    );
  }
  if (
    payload.format !== PayloadFormat.Json &&
    payload.format !== PayloadFormat.Web
  ) {
    throw new TransformerException(
      TransformerErrorCode.UnsupportedFormat,
      'Only JSON and HTML payloads are supported.',
    );
  }
  if (
    payload.format === PayloadFormat.Web &&
    typeof payload.data !== 'string'
  ) {
    throw new TransformerException(
      TransformerErrorCode.ValidationFailed,
      'HTML data must be a string.',
    );
  }
  return {
    inputId: value.inputId,
    source: {
      id: source.id,
      version: source.version,
      platform: source.platform,
    },
    payload: { format: payload.format, data: payload.data },
  };
}
