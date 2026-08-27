ALTER TABLE "Message" ADD COLUMN "readAt" TIMESTAMP(3);

CREATE INDEX "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt");

CREATE INDEX "Message_receiverId_createdAt_idx" ON "Message"("receiverId", "createdAt");
