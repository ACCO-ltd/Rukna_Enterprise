import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { RequestIdentity } from '@erp/types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestIdentity => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as RequestIdentity;
  },
);
