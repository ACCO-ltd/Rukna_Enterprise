-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('PERMIT', 'LICENSE', 'DRAWING', 'CONTRACT', 'CERTIFICATE', 'INSURANCE', 'GUARANTEE', 'CORRESPONDENCE', 'PHOTO', 'OTHER');

-- CreateTable
CREATE TABLE "project_documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "platform_file_id" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_documents_project_id_idx" ON "project_documents"("project_id");

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

