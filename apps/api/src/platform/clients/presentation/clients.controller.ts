import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ClientService } from '../application/client.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';
import { AddContactDto } from './dto/add-contact.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';
import { DeactivateClientDto } from './dto/deactivate-client.dto.js';
import { ClientActivityQueryDto, ClientListQueryDto } from './dto/client-list-query.dto.js';

/**
 * Clients (platform). Contract: docs/design/clients-redesign-contract.md. Money fields follow one
 * gate, `view:financial-position` — without it they are `null`, never `'0.00'`.
 */
@ApiTags('Clients')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.clientsView)
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientService: ClientService) {}

  @Get()
  @ApiOperation({ summary: 'List all clients for the authenticated organization (pickers)' })
  findAll(@CurrentUser() identity: RequestIdentity) {
    return this.clientService.findAll(identity);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Client list: search, filters, sort, pagination; money gated' })
  findSummary(@CurrentUser() identity: RequestIdentity, @Query() query: ClientListQueryDto) {
    return this.clientService.findList(identity, query);
  }

  @Get('duplicate-candidates')
  @ApiOperation({ summary: 'Find possible duplicate clients by name' })
  findDuplicateCandidates(@CurrentUser() identity: RequestIdentity, @Query('name') name = '') {
    return this.clientService.findDuplicateCandidates(identity, name);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.clientsCreate)
  @ApiOperation({ summary: 'Create a client with its primary contact' })
  @ApiResponse({ status: 201, description: 'Client created (same shape as GET /clients/:id)' })
  @ApiResponse({ status: 400, description: 'PHONE_INVALID / EMAIL_INVALID / NAME_INVALID …' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateClientDto) {
    return this.clientService.create(identity, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Client record incl. contacts, allowedCommands, deactivationBlockedBy' })
  @ApiParam({ name: 'id', description: 'Client ID' })
  findOne(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.clientService.findOne(identity, id);
  }

  @Get(':id/overview')
  @ApiOperation({ summary: 'Client record overview: metrics, projects, unpaid invoices (money gated)' })
  @ApiParam({ name: 'id', description: 'Client ID' })
  findOverview(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.clientService.findOverview(identity, id);
  }

  @Get(':id/activity')
  @ApiOperation({ summary: 'Client activity: audit entries, plus invoices/receipts with money permission' })
  @ApiParam({ name: 'id', description: 'Client ID' })
  findActivity(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Query() query: ClientActivityQueryDto,
  ) {
    return this.clientService.findActivity(identity, id, query.limit ?? 10);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.clientsManage)
  @ApiOperation({ summary: 'Update client master data (not contacts, not status)' })
  @ApiParam({ name: 'id', description: 'Client ID' })
  update(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clientService.update(identity, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermissions(PERMISSIONS.clientsManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a client (409 CLIENT_HAS_ACTIVE_PROJECTS / CLIENT_HAS_OPEN_BALANCE)' })
  @ApiParam({ name: 'id', description: 'Client ID' })
  deactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string, @Body() dto: DeactivateClientDto) {
    return this.clientService.deactivate(identity, id, dto.reason);
  }

  @Post(':id/reactivate')
  @RequirePermissions(PERMISSIONS.clientsManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate an inactive client' })
  @ApiParam({ name: 'id', description: 'Client ID' })
  reactivate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.clientService.reactivate(identity, id);
  }

  @Post(':id/contacts')
  @RequirePermissions(PERMISSIONS.clientsManage)
  @ApiOperation({ summary: 'Add a contact (the first is always primary; isPrimary demotes the current one)' })
  @ApiParam({ name: 'id', description: 'Client ID' })
  addContact(@CurrentUser() identity: RequestIdentity, @Param('id') clientId: string, @Body() dto: AddContactDto) {
    return this.clientService.addContact(identity, clientId, dto);
  }

  @Patch(':id/contacts/:contactId')
  @RequirePermissions(PERMISSIONS.clientsManage)
  @ApiOperation({ summary: 'Edit a contact' })
  @ApiParam({ name: 'id', description: 'Client ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID' })
  updateContact(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') clientId: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.clientService.updateContact(identity, clientId, contactId, dto);
  }

  @Post(':id/contacts/:contactId/make-primary')
  @RequirePermissions(PERMISSIONS.clientsManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make this contact the primary (demotes the current one, one transaction)' })
  @ApiParam({ name: 'id', description: 'Client ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID' })
  makePrimary(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') clientId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.clientService.makePrimary(identity, clientId, contactId);
  }

  @Delete(':id/contacts/:contactId')
  @RequirePermissions(PERMISSIONS.clientsManage)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a contact (409 CONTACT_IS_PRIMARY for the primary)' })
  @ApiParam({ name: 'id', description: 'Client ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID' })
  removeContact(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') clientId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.clientService.removeContact(identity, clientId, contactId);
  }
}
