import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, SavedView } from '@prisma/client';
import {
  PERMISSIONS,
  type CreateSavedViewInput,
  type RequestIdentity,
  type SavedViewDto,
  type SavedViewState,
  type UpdateSavedViewInput,
} from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import { SavedViewsRepository } from '../infrastructure/saved-views.repository.js';
import {
  LIST_KEY_PATTERN,
  MAX_VIEWS_PER_USER_PER_LIST,
  VIEW_NAME_MAX,
  normaliseSavedViewState,
  savedViewStateProblems,
} from '../domain/saved-view-rules.js';

/**
 * Step 2a (ADR-047): saved list views. A view is personal to its owner; an admin
 * (manage:organization) may publish it so everyone in the company sees it, and may then edit or
 * remove it. Only the owner sees an unpublished view — to anyone else it does not exist (404).
 */
@Injectable()
export class SavedViewsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: SavedViewsRepository,
  ) {}

  async list(identity: RequestIdentity, listKey: string): Promise<SavedViewDto[]> {
    this.assertListKey(listKey);
    const rows = await this.repo.listVisible(this.tenancy.getClient(), identity.activeOrganizationId, listKey, identity.userId);
    return rows.map((row) => this.toDto(row, identity));
  }

  async create(identity: RequestIdentity, input: CreateSavedViewInput): Promise<SavedViewDto> {
    this.assertListKey(input.listKey);
    const name = this.cleanName(input.name);
    const state = this.cleanState(input.state);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    if ((await this.repo.countOwned(prisma, orgId, input.listKey, identity.userId)) >= MAX_VIEWS_PER_USER_PER_LIST) {
      throw new ConflictException({
        errorCode: 'SAVED_VIEW_LIMIT',
        message: `You can save at most ${MAX_VIEWS_PER_USER_PER_LIST} views on one list. Delete one first.`,
      });
    }
    await this.assertNameFree(identity, input.listKey, name);

    const row = await this.repo.create(prisma, {
      organizationId: orgId,
      listKey: input.listKey,
      name,
      state: state as Prisma.InputJsonValue,
      ownerUserId: identity.userId,
    });
    return this.toDto(row, identity);
  }

  async update(identity: RequestIdentity, id: string, input: UpdateSavedViewInput): Promise<SavedViewDto> {
    const row = await this.findEditable(identity, id);
    const data: { name?: string; state?: Prisma.InputJsonValue } = {};
    if (input.name !== undefined) {
      data.name = this.cleanName(input.name);
      if (data.name.toLowerCase() !== row.name.toLowerCase()) await this.assertNameFree(identity, row.listKey, data.name, row.ownerUserId);
    }
    if (input.state !== undefined) data.state = this.cleanState(input.state) as Prisma.InputJsonValue;
    const updated = await this.repo.update(this.tenancy.getClient(), id, data);
    return this.toDto(updated, identity);
  }

  async setPublished(identity: RequestIdentity, id: string, published: boolean): Promise<SavedViewDto> {
    if (!this.isAdmin(identity)) {
      throw new ForbiddenException('Only an administrator can publish a view to everyone.');
    }
    const row = await this.findVisible(identity, id);
    const updated = await this.repo.update(this.tenancy.getClient(), row.id, { published });
    return this.toDto(updated, identity);
  }

  async remove(identity: RequestIdentity, id: string): Promise<void> {
    const row = await this.findEditable(identity, id);
    await this.repo.delete(this.tenancy.getClient(), row.id);
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private isAdmin(identity: RequestIdentity): boolean {
    return identity.permissions.includes(PERMISSIONS.organizationsManage);
  }

  private async findVisible(identity: RequestIdentity, id: string): Promise<SavedView> {
    const row = await this.repo.findById(this.tenancy.getClient(), identity.activeOrganizationId, id);
    if (!row || (!row.published && row.ownerUserId !== identity.userId)) throw new NotFoundException('View not found');
    return row;
  }

  /** The owner may change their view; an admin may also change a published one. */
  private async findEditable(identity: RequestIdentity, id: string): Promise<SavedView> {
    const row = await this.findVisible(identity, id);
    if (row.ownerUserId !== identity.userId && !(row.published && this.isAdmin(identity))) {
      throw new ForbiddenException('This view was published by someone else. Ask an administrator to change it.');
    }
    return row;
  }

  private assertListKey(listKey: string): void {
    if (!LIST_KEY_PATTERN.test(listKey)) throw new BadRequestException('Unknown list.');
  }

  private cleanName(name: string): string {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > VIEW_NAME_MAX) {
      throw new BadRequestException({ errorCode: 'SAVED_VIEW_INVALID', message: `A view needs a name of 1–${VIEW_NAME_MAX} characters.` });
    }
    return trimmed;
  }

  private cleanState(state: SavedViewState): SavedViewState {
    const problems = savedViewStateProblems(state);
    if (problems.length > 0) {
      throw new BadRequestException({ errorCode: 'SAVED_VIEW_INVALID', message: problems.join(' '), details: { problems } });
    }
    return normaliseSavedViewState(state);
  }

  private async assertNameFree(identity: RequestIdentity, listKey: string, name: string, ownerUserId = identity.userId) {
    const clash = await this.repo.findOwnedByName(this.tenancy.getClient(), identity.activeOrganizationId, listKey, ownerUserId, name);
    if (clash) {
      throw new ConflictException({ errorCode: 'SAVED_VIEW_NAME_TAKEN', message: `A view called "${name}" already exists on this list.` });
    }
  }

  private toDto(row: SavedView, identity: RequestIdentity): SavedViewDto {
    return {
      id: row.id,
      listKey: row.listKey,
      name: row.name,
      state: row.state as SavedViewState,
      published: row.published,
      mine: row.ownerUserId === identity.userId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
