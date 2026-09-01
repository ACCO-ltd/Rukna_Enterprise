import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class ReorderPolicyRulesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ruleIds!: string[];
}
