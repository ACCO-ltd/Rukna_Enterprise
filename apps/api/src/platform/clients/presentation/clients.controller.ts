import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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

@ApiTags('Clients')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.clientsView)
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientService: ClientService) {}

  @Get()
  @ApiOperation({ summary: 'List all clients for the authenticated organization' })
  findAll(@CurrentUser() identity: RequestIdentity) {
    return this.clientService.findAll(identity);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.clientsCreate)
  @ApiOperation({ summary: 'Create a new client' })
  @ApiResponse({ status: 201, description: 'Client created' })
  @ApiResponse({ status: 409, description: 'Client code already exists' })
  create(@CurrentUser() identity: RequestIdentity, @Body() dto: CreateClientDto) {
    return this.clientService.create(identity, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get client details including contacts' })
  @ApiParam({ name: 'id', description: 'Client ID' })
  findOne(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.clientService.findOne(identity, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.clientsManage)
  @ApiOperation({ summary: 'Update client details' })
  @ApiParam({ name: 'id', description: 'Client ID' })
  update(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientService.update(identity, id, dto);
  }

  @Post(':id/contacts')
  @RequirePermissions(PERMISSIONS.clientsManage)
  @ApiOperation({ summary: 'Add a contact to a client' })
  @ApiParam({ name: 'id', description: 'Client ID' })
  addContact(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') clientId: string,
    @Body() dto: AddContactDto,
  ) {
    return this.clientService.addContact(identity, clientId, dto);
  }

  @Delete(':id/contacts/:contactId')
  @RequirePermissions(PERMISSIONS.clientsManage)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a contact from a client' })
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
