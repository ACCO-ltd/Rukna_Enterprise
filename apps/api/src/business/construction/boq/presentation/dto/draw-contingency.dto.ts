import { IsString, IsDecimal } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * A contingency draw — ADR-029 CONST-BOQ-028 / spec C-3.
 *
 * Moves `amount` of budget from a CONTINGENCY allowance leaf onto a target leaf, keeping the
 * in-contract total constant. `amount` is a decimal **string** (CONST-BOQ-014), up to 2 dp — the
 * same money convention every BOQ figure crosses the wire in. The source contingency leaf is
 * resolved server-side (there is one named allowance); the caller only names the target and the
 * amount.
 */
export class DrawContingencyDto {
  @ApiProperty({
    description: 'The leaf the drawn budget funds. Must be an allowance-style (quantity = 1) leaf.',
  })
  @IsString()
  toNodeId!: string;

  @ApiProperty({
    example: '500.00',
    description: 'How much to draw from contingency onto the target, decimal string up to 2 dp.',
  })
  @IsDecimal({ decimal_digits: '0,2' })
  amount!: string;
}
