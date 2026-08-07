import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';
import type { MaterialRequestStatus, MaterialRequestScope, ProcurementLineType } from '@prisma/client';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { MaterialRequestRepository } from '../infrastructure/material-request.repository.js';
import { MaterialRepository } from '../../catalogue/infrastructure/material.repository.js';
import { UomRepository } from '../../catalogue/infrastructure/uom.repository.js';

export interface CreateMrLineDto {
  lineType: ProcurementLineType;
  materialCode?: string;
  description: string;
  uomCode: string;
  requestedQuantity: number;
  boqNodeId?: string;
  spendCategoryId?: string;
  departmentId?: string;
  costCenterId?: string;
  projectCostCategoryId?: string;
  notes?: string;
}

export interface CreateMaterialRequestDto {
  requestScope: MaterialRequestScope;
  projectId?: string;
  requestedDate: string;
  requiredByDate?: string;
  description?: string;
  notes?: string;
  lines: CreateMrLineDto[];
}

// Valid transitions from each status
const NEXT_STATUS: Partial<Record<MaterialRequestStatus, MaterialRequestStatus[]>> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['PARTIALLY_ORDERED', 'FULLY_ORDERED', 'CANCELLED', 'CLOSED'],
  PARTIALLY_ORDERED: ['FULLY_ORDERED', 'CLOSED'],
};

@Injectable()
export class MaterialRequestService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: MaterialRequestRepository,
    private readonly materialRepo: MaterialRepository,
    private readonly uomRepo: UomRepository,
  ) {}

  findAll(identity: RequestIdentity, filters?: { status?: MaterialRequestStatus; projectId?: string; scope?: MaterialRequestScope }) {
    const prisma = this.tenancy.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, filters);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const mr = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!mr) throw new NotFoundException(`Material request ${id} not found`);
    return mr;
  }

  async create(identity: RequestIdentity, dto: CreateMaterialRequestDto) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    // Rule MR-001: PROJECT scope requires projectId
    if (dto.requestScope === 'PROJECT' && !dto.projectId) {
      throw new BadRequestException('projectId is required for PROJECT-scoped material requests');
    }
    // Rule MR-002: ORGANIZATION scope must not have projectId
    if (dto.requestScope === 'ORGANIZATION' && dto.projectId) {
      throw new BadRequestException('projectId must be null for ORGANIZATION-scoped material requests');
    }

    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('At least one line is required');
    }

    // Resolve and validate lines
    const resolvedLines = await Promise.all(
      dto.lines.map(async (line, i) => {
        // Rule CAT-001: MATERIAL type requires materialCode
        if (line.lineType === 'MATERIAL' && !line.materialCode) {
          throw new BadRequestException(`Line ${i + 1}: materialCode is required for MATERIAL type`);
        }

        let materialId: string | undefined;
        let resolvedUomId: string;

        if (line.materialCode) {
          const material = await this.materialRepo.findByCode(prisma, orgId, line.materialCode);
          if (!material) throw new NotFoundException(`Line ${i + 1}: material '${line.materialCode}' not found`);
          if (material.status !== 'ACTIVE') throw new BadRequestException(`Line ${i + 1}: material '${line.materialCode}' is not active`);
          materialId = material.id;
          // Rule UOM-001: MATERIAL lines use Material.baseUnitOfMeasureId
          resolvedUomId = material.baseUnitOfMeasureId;
        } else {
          const uom = await this.uomRepo.findByCode(prisma, orgId, line.uomCode);
          if (!uom) throw new NotFoundException(`Line ${i + 1}: UoM '${line.uomCode}' not found`);
          resolvedUomId = uom.id;
        }

        return {
          lineNumber: i + 1,
          lineType: line.lineType,
          materialId,
          description: line.description,
          unitOfMeasureId: resolvedUomId,
          requestedQuantity: new Decimal(line.requestedQuantity),
          boqNodeId: line.boqNodeId,
          spendCategoryId: line.spendCategoryId,
          departmentId: line.departmentId,
          costCenterId: line.costCenterId,
          projectCostCategoryId: line.projectCostCategoryId,
          notes: line.notes,
        };
      }),
    );

    const count = await this.repo.nextMrNumber(prisma, orgId);
    const mrNumber = `MR-${String(count).padStart(5, '0')}`;

    return this.repo.create(prisma, {
      organizationId: orgId,
      mrNumber,
      requestScope: dto.requestScope,
      projectId: dto.projectId,
      requestedBy: identity.userId,
      requestedDate: new Date(dto.requestedDate),
      requiredByDate: dto.requiredByDate ? new Date(dto.requiredByDate) : undefined,
      description: dto.description,
      notes: dto.notes,
      lines: resolvedLines,
    });
  }

  async submit(identity: RequestIdentity, id: string) {
    return this.transition(identity, id, 'SUBMITTED');
  }

  async approve(identity: RequestIdentity, id: string) {
    return this.transition(identity, id, 'APPROVED');
  }

  async cancel(identity: RequestIdentity, id: string) {
    return this.transition(identity, id, 'CANCELLED');
  }

  private async transition(identity: RequestIdentity, id: string, to: MaterialRequestStatus) {
    const prisma = this.tenancy.getClient();
    const mr = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!mr) throw new NotFoundException(`Material request ${id} not found`);

    const allowed = NEXT_STATUS[mr.status] ?? [];
    if (!allowed.includes(to)) {
      throw new ConflictException(`Cannot transition MR from ${mr.status} to ${to}`);
    }

    return this.repo.updateStatus(prisma, id, to);
  }
}
