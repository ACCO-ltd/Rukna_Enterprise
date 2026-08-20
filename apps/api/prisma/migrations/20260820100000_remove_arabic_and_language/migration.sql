-- AlterTable
ALTER TABLE "account_versions" DROP COLUMN "name_ar";

-- AlterTable
ALTER TABLE "bank_accounts" DROP COLUMN "account_name_ar";

-- AlterTable
ALTER TABLE "boq_nodes" DROP COLUMN "description_ar";

-- AlterTable
ALTER TABLE "clients" DROP COLUMN "name_ar";

-- AlterTable
ALTER TABLE "cost_center_versions" DROP COLUMN "name_ar";

-- AlterTable
ALTER TABLE "department_versions" DROP COLUMN "name_ar";

-- AlterTable
ALTER TABLE "material_categories" DROP COLUMN "name_ar";

-- AlterTable
ALTER TABLE "materials" DROP COLUMN "name_ar";

-- AlterTable
ALTER TABLE "projects" DROP COLUMN "name_ar";

-- AlterTable
ALTER TABLE "spend_categories" DROP COLUMN "name_ar";

-- AlterTable
ALTER TABLE "suppliers" DROP COLUMN "name_ar";

-- AlterTable
ALTER TABLE "tax_codes" DROP COLUMN "name_ar";

-- AlterTable
ALTER TABLE "units_of_measure" DROP COLUMN "name_ar";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "preferred_language";

-- AlterTable
ALTER TABLE "workflow_definitions" DROP COLUMN "name_ar";

-- DropEnum
DROP TYPE "Language";

