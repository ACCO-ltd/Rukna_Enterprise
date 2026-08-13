import { Global, Module } from '@nestjs/common';

import { ProjectAccessService } from './project-access.service.js';
import { ProjectAccessGuard } from './project-access.guard.js';

/** Cross-cutting authorization policy; business modules depend only on this platform boundary. */
@Global()
@Module({
  providers: [ProjectAccessService, ProjectAccessGuard],
  exports: [ProjectAccessService, ProjectAccessGuard],
})
export class ProjectAccessModule {}
