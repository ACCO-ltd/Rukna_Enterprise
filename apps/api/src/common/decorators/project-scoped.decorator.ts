import { SetMetadata } from '@nestjs/common';

export const PROJECT_ID_PARAM_KEY = 'project_id_param';

export const ProjectScoped = (parameterName = 'projectId'): MethodDecorator & ClassDecorator =>
  SetMetadata(PROJECT_ID_PARAM_KEY, parameterName);
