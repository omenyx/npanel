import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { randomBytes, createHash } from 'node:crypto';
import { ActionIntentEntity } from './action-intent.entity';
import { AuditLogEntity } from './audit-log.entity';
import { encryptString, decryptString } from '../system/secretbox';

export type GovernanceActor = {
  actorId?: string;
  actorRole?: string;
  actorType?: string;
  reason?: string;
};

export type ActionConfirmation = {
  intentId: string;
  token: string;
  tokenExpiresAt: string;
  confirmation: {
    module: string;
    action: string;
    targetKind: string;
    targetKey: string;
    impactedSubsystems: string[];
    reversibility: 'reversible' | 'requires_restore' | 'irreversible';
    risk: 'Low' | 'Medium' | 'High';
  };
};

export type ActionStep = {
  name: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  details?: Record<string, unknown>;
  errorMessage?: string | null;
};

export type ActionResultEnvelope<T = unknown> = {
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';
  steps: ActionStep[];
  auditLogId: string;
  result?: T;
};

@Injectable()
export class GovernanceService {
  constructor(
    @InjectRepository(ActionIntentEntity)
    private readonly intents: Repository<ActionIntentEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly audit: Repository<AuditLogEntity>,
  ) {}

  async prepare(input: {
    module: string;
    action: string;
    targetKind: string;
    targetKey: string;
    payload: Record<string, unknown>;
    risk: 'low' | 'medium' | 'high';
    reversibility: 'reversible' | 'requires_restore' | 'irreversible';
    impactedSubsystems: string[];
    actor?: GovernanceActor;
  }): Promise<ActionConfirmation> {
    const token = randomBytes(24).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const tokenExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    // opportunistic TTL cleanup for previously expired/confirmed intents
    await this.cleanupIntents();
    const intent = await this.intents.save({
      module: input.module,
      action: input.action,
      targetKind: input.targetKind,
      targetKey: input.targetKey,
      payload: encryptString(JSON.stringify(input.payload ?? {})),
      risk: input.risk,
      reversibility: input.reversibility,
      status: 'prepared',
      token: tokenHash,
      tokenExpiresAt,
      actorId: input.actor?.actorId ?? null,
      actorRole: input.actor?.actorRole ?? null,
      actorType: input.actor?.actorType ?? null,
      reason: input.actor?.reason ?? null,
    } as any);

    await this.audit.save({
      module: input.module,
      action: input.action,
      phase: 'confirmation',
      targetKind: input.targetKind,
      targetKey: input.targetKey,
      outcome: 'success',
      actorId: input.actor?.actorId ?? null,
      actorRole: input.actor?.actorRole ?? null,
      actorType: input.actor?.actorType ?? null,
      reason: input.actor?.reason ?? null,
      details: {
        intentId: intent.id,
        tokenExpiresAt: tokenExpiresAt.toISOString(),
        risk: input.risk,
        reversibility: input.reversibility,
        impactedSubsystems: input.impactedSubsystems,
      },
      errorMessage: null,
    } as any);

    return {
      intentId: intent.id,
      token,
      tokenExpiresAt: tokenExpiresAt.toISOString(),
      confirmation: {
        module: input.module,
        action: input.action,
        targetKind: input.targetKind,
        targetKey: input.targetKey,
        impactedSubsystems: input.impactedSubsystems,
        reversibility: input.reversibility,
        risk:
          input.risk === 'high'
            ? 'High'
            : input.risk === 'medium'
              ? 'Medium'
              : 'Low',
      },
    };
  }

  async verify(intentId: string, token: string): Promise<ActionIntentEntity> {
    return this.verifyWithActor(intentId, token);
  }

  async verifyWithActor(
    intentId: string,
    token: string,
    expectedActor?: GovernanceActor,
  ): Promise<ActionIntentEntity> {
    const intent = await this.intents.findOne({ where: { id: intentId } });
    if (!intent) throw new NotFoundException('Action intent not found');
    if (intent.status !== 'prepared')
      throw new BadRequestException(
        'Action intent is not pending confirmation',
      );
    const tokenHash = createHash('sha256').update(token).digest('hex');
    if (intent.token !== tokenHash)
      throw new BadRequestException('Invalid confirmation token');
    if (
      expectedActor?.actorId &&
      intent.actorId &&
      intent.actorId !== expectedActor.actorId
    ) {
      throw new BadRequestException('Action intent actor mismatch');
    }
    if (intent.tokenExpiresAt.getTime() < Date.now()) {
      intent.status = 'expired';
      await this.intents.save(intent as any);
      throw new BadRequestException('Confirmation token expired');
    }
    // decrypt payload in-memory for downstream usage
    try {
      const decrypted = decryptString(intent.payload);
      (intent as any).payload = JSON.parse(decrypted);
    } catch {
      (intent as any).payload = {};
    }
    return intent;
  }

  async recordResult(input: {
    intent: ActionIntentEntity;
    status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';
    steps: ActionStep[];
    result?: unknown;
    errorMessage?: string | null;
  }): Promise<ActionResultEnvelope> {
    input.intent.status = 'confirmed';
    input.intent.token = 'used';
    input.intent.payload = '';
    await this.intents.save(input.intent as any);
    const outcome =
      input.status === 'SUCCESS'
        ? 'success'
        : input.status === 'PARTIAL_SUCCESS'
          ? 'partial'
          : 'failed';
    const audit = await this.audit.save({
      module: input.intent.module,
      action: input.intent.action,
      phase: 'result',
      targetKind: input.intent.targetKind,
      targetKey: input.intent.targetKey,
      outcome,
      actorId: input.intent.actorId,
      actorRole: input.intent.actorRole,
      actorType: input.intent.actorType,
      reason: input.intent.reason,
      details: {
        intentId: input.intent.id,
        steps: input.steps,
      },
      errorMessage: input.errorMessage ?? null,
    } as any);
    return {
      status: input.status,
      steps: input.steps,
      auditLogId: audit.id,
      result: input.result,
    };
  }

  private async cleanupIntents(): Promise<void> {
    const now = Date.now();
    const expiredCutoff = new Date(now - 24 * 60 * 60 * 1000); // 24h for expired
    const confirmedCutoff = new Date(now - 7 * 24 * 60 * 60 * 1000); // 7d for confirmed
    await this.intents.delete({
      status: 'expired',
      updatedAt: LessThan(expiredCutoff),
    } as any);
    await this.intents.delete({
      status: 'confirmed',
      updatedAt: LessThan(confirmedCutoff),
    } as any);
  }
}
