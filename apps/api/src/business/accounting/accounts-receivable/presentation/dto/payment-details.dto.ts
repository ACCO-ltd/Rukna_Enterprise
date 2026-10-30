import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * PM-1 — the proof behind a receipt's payment method. Which fields are required depends on the
 * method (domain/receipt-payment-method.ts); the service checks them and drops the rest.
 */
export class PaymentDetailsDto {
  @ApiPropertyOptional({ description: 'Transfer reference · cheque number · mobile transaction ID · card authorisation code · cash receipt-book number' })
  @IsOptional() @IsString() @MaxLength(60)
  instrumentNumber?: string;

  @ApiPropertyOptional({ description: 'Paying bank · drawee bank · mobile provider (EVC_PLUS, ZAAD, SAHAL, EDAHAB) · card type (VISA, MASTERCARD, OTHER)' })
  @IsOptional() @IsString() @MaxLength(80)
  issuer?: string;

  @ApiPropertyOptional({ description: 'Transfer value date · cheque date (later than the receipt date = cheque on hand)' })
  @IsOptional() @IsDateString()
  instrumentDate?: string;

  @ApiPropertyOptional({ description: "Payer's account name · name on cheque · sender's name" })
  @IsOptional() @IsString() @MaxLength(150)
  payerName?: string;

  @ApiPropertyOptional({ description: "Payer's account (last 4) · sender's phone · card last 4" })
  @IsOptional() @IsString() @MaxLength(30)
  payerAccount?: string;

  @ApiPropertyOptional({ description: 'Cash: who counted it' })
  @IsOptional() @IsString() @MaxLength(100)
  receivedBy?: string;
}
