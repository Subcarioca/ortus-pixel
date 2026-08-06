-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "accentColor" TEXT NOT NULL DEFAULT '#7C3AED',
    "monitoringPriority" INTEGER NOT NULL DEFAULT 5,
    "launchPhase" INTEGER NOT NULL DEFAULT 1,
    "affiliateWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subcategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "categoryId" TEXT NOT NULL,
    "affiliateWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subcategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Franchise" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "heroImageUrl" TEXT,
    "logoUrl" TEXT,
    "primaryCategoryId" TEXT NOT NULL,
    "audienceAffinityIndex" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "followerCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Franchise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'generic',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Author" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT,
    "role" TEXT NOT NULL DEFAULT 'Redator',
    "socialLinks" JSONB NOT NULL DEFAULT '[]',
    "expertiseAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "systemRole" TEXT NOT NULL DEFAULT 'writer',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Author_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "categoryId" TEXT,
    "sourceUrl" TEXT,
    "sourceName" TEXT,
    "sourceTier" TEXT NOT NULL DEFAULT 'unverified',
    "dedupeHash" TEXT NOT NULL,
    "currentScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentBand" TEXT NOT NULL DEFAULT 'EVERGREEN',
    "scoreDelta1h" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "seoOpportunity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "termType" TEXT NOT NULL DEFAULT 'mid',
    "emotionalTriggers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "scoreSummary" TEXT NOT NULL DEFAULT '',
    "weightsVersion" TEXT NOT NULL DEFAULT '',
    "manualScoreOverride" DOUBLE PRECISION,
    "manualOverrideReason" TEXT,
    "manualOverrideById" TEXT,
    "manualOverrideAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'new',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScoredAt" TIMESTAMP(3),
    "becameHotAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "claimedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicFranchise" (
    "topicId" TEXT NOT NULL,
    "franchiseId" TEXT NOT NULL,

    CONSTRAINT "TopicFranchise_pkey" PRIMARY KEY ("topicId","franchiseId")
);

-- CreateTable
CREATE TABLE "ScoreSnapshot" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "band" TEXT NOT NULL,
    "seoOpportunity" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "contributions" JSONB NOT NULL,
    "weightsVersion" TEXT NOT NULL,
    "isShadow" BOOLEAN NOT NULL DEFAULT false,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalReading" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "rawValue" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT,
    "rawPayload" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorHealth" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "circuitState" TEXT NOT NULL DEFAULT 'closed',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "totalFailures" INTEGER NOT NULL DEFAULT 0,
    "avgDurationMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "circuitOpenUntil" TIMESTAMP(3),
    "callsThisPeriod" INTEGER NOT NULL DEFAULT 0,
    "periodResetAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "categoryId" TEXT NOT NULL,
    "subcategoryId" TEXT,
    "authorId" TEXT NOT NULL,
    "topicId" TEXT,
    "coverImageUrl" TEXT,
    "coverImageAlt" TEXT,
    "videoUrl" TEXT,
    "videoThumbnailUrl" TEXT,
    "videoDurationSeconds" INTEGER,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "canonicalUrl" TEXT,
    "noIndex" BOOLEAN NOT NULL DEFAULT false,
    "isBreaking" BOOLEAN NOT NULL DEFAULT false,
    "readingMinutes" INTEGER NOT NULL DEFAULT 1,
    "format" TEXT NOT NULL DEFAULT 'breaking',
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "updatesCount" INTEGER NOT NULL DEFAULT 0,
    "hasSpoiler" BOOLEAN NOT NULL DEFAULT false,
    "tldr" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewData" JSONB,
    "scoreAtPublish" DOUBLE PRECISION,
    "currentScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentBand" TEXT NOT NULL DEFAULT 'EVERGREEN',
    "scoreDelta1h" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scoreUpdatedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "pageviews24h" INTEGER,
    "avgTimeOnPageSeconds" DOUBLE PRECISION,
    "scrollDepthAvg" DOUBLE PRECISION,
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hasAffiliateLinks" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleFranchise" (
    "articleId" TEXT NOT NULL,
    "franchiseId" TEXT NOT NULL,

    CONSTRAINT "ArticleFranchise_pkey" PRIMARY KEY ("articleId","franchiseId")
);

-- CreateTable
CREATE TABLE "ArticleTag" (
    "articleId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ArticleTag_pkey" PRIMARY KEY ("articleId","tagId")
);

-- CreateTable
CREATE TABLE "LiveUpdate" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isHighlight" BOOLEAN NOT NULL DEFAULT false,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateOffer" (
    "id" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "retailerName" TEXT NOT NULL,
    "brand" TEXT,
    "priceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "offerUrl" TEXT NOT NULL,
    "programCategory" TEXT NOT NULL DEFAULT 'outro',
    "network" TEXT,
    "externalId" TEXT,
    "imageUrl" TEXT,
    "availability" TEXT NOT NULL DEFAULT 'unknown',
    "disclosureKind" TEXT NOT NULL DEFAULT 'affiliate',
    "priceUpdatedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "AffiliateOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleAffiliateOffer" (
    "articleId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isHighlighted" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleAffiliateOffer_pkey" PRIMARY KEY ("articleId","offerId")
);

-- CreateTable
CREATE TABLE "ReleaseEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "franchiseId" TEXT,
    "kind" TEXT NOT NULL,
    "releaseDate" TIMESTAMP(3) NOT NULL,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "platform" TEXT,
    "region" TEXT NOT NULL DEFAULT 'BR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confirmationTokenHash" TEXT,
    "confirmationExpiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "unsubscribeTokenHash" TEXT,
    "unsubscribedAt" TIMESTAMP(3),
    "preferredCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signupIpHash" TEXT,
    "signupUserAgent" TEXT,
    "signupSource" TEXT NOT NULL DEFAULT 'site',
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    "emailsOpened" INTEGER NOT NULL DEFAULT 0,
    "emailsClicked" INTEGER NOT NULL DEFAULT 0,
    "lastOpenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "preferredCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredFranchises" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minScoreThreshold" INTEGER NOT NULL DEFAULT 80,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastFailureAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "notificationsSent" INTEGER NOT NULL DEFAULT 0,
    "notificationsClicked" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushNotification" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "iconUrl" TEXT,
    "url" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "scoreAtTrigger" DOUBLE PRECISION,
    "approvedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "clickedCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseFollow" (
    "id" TEXT NOT NULL,
    "franchiseId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchiseFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentAuthor" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "emailHash" TEXT,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedAt" TIMESTAMP(3),
    "blockReason" TEXT,
    "approvedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentAuthor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "authorAccountId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorEmailHash" TEXT,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "moderatedAt" TIMESTAMP(3),
    "moderatedBy" TEXT,
    "moderationNote" TEXT,
    "parentId" TEXT,
    "ipHash" TEXT,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "topicId" TEXT,
    "articleId" TEXT,
    "connectorId" TEXT,
    "actorId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "topicsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "topicsScored" INTEGER NOT NULL DEFAULT 0,
    "topicsPromoted" INTEGER NOT NULL DEFAULT 0,
    "connectorsRun" INTEGER NOT NULL DEFAULT 0,
    "connectorsFailed" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostCents" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "error" TEXT,

    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_monitoringPriority_idx" ON "Category"("monitoringPriority");

-- CreateIndex
CREATE INDEX "Subcategory_slug_idx" ON "Subcategory"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Subcategory_categoryId_slug_key" ON "Subcategory"("categoryId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Franchise_slug_key" ON "Franchise"("slug");

-- CreateIndex
CREATE INDEX "Franchise_primaryCategoryId_idx" ON "Franchise"("primaryCategoryId");

-- CreateIndex
CREATE INDEX "Franchise_audienceAffinityIndex_idx" ON "Franchise"("audienceAffinityIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "Tag_kind_idx" ON "Tag"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "Author_slug_key" ON "Author"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Author_email_key" ON "Author"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_dedupeHash_key" ON "Topic"("dedupeHash");

-- CreateIndex
CREATE INDEX "Topic_status_currentScore_idx" ON "Topic"("status", "currentScore" DESC);

-- CreateIndex
CREATE INDEX "Topic_currentBand_becameHotAt_idx" ON "Topic"("currentBand", "becameHotAt");

-- CreateIndex
CREATE INDEX "Topic_categoryId_currentScore_idx" ON "Topic"("categoryId", "currentScore" DESC);

-- CreateIndex
CREATE INDEX "Topic_firstSeenAt_idx" ON "Topic"("firstSeenAt");

-- CreateIndex
CREATE INDEX "TopicFranchise_franchiseId_idx" ON "TopicFranchise"("franchiseId");

-- CreateIndex
CREATE INDEX "ScoreSnapshot_topicId_calculatedAt_idx" ON "ScoreSnapshot"("topicId", "calculatedAt" DESC);

-- CreateIndex
CREATE INDEX "ScoreSnapshot_calculatedAt_idx" ON "ScoreSnapshot"("calculatedAt");

-- CreateIndex
CREATE INDEX "ScoreSnapshot_weightsVersion_isShadow_idx" ON "ScoreSnapshot"("weightsVersion", "isShadow");

-- CreateIndex
CREATE INDEX "SignalReading_topicId_observedAt_idx" ON "SignalReading"("topicId", "observedAt" DESC);

-- CreateIndex
CREATE INDEX "SignalReading_connectorId_observedAt_idx" ON "SignalReading"("connectorId", "observedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorHealth_connectorId_key" ON "ConnectorHealth"("connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");

-- CreateIndex
CREATE INDEX "Article_status_publishedAt_idx" ON "Article"("status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Article_status_currentScore_idx" ON "Article"("status", "currentScore" DESC);

-- CreateIndex
CREATE INDEX "Article_categoryId_status_publishedAt_idx" ON "Article"("categoryId", "status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Article_subcategoryId_status_publishedAt_idx" ON "Article"("subcategoryId", "status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Article_topicId_idx" ON "Article"("topicId");

-- CreateIndex
CREATE INDEX "Article_authorId_idx" ON "Article"("authorId");

-- CreateIndex
CREATE INDEX "ArticleFranchise_franchiseId_idx" ON "ArticleFranchise"("franchiseId");

-- CreateIndex
CREATE INDEX "ArticleTag_tagId_idx" ON "ArticleTag"("tagId");

-- CreateIndex
CREATE INDEX "LiveUpdate_articleId_createdAt_idx" ON "LiveUpdate"("articleId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AffiliateOffer_isActive_priceUpdatedAt_idx" ON "AffiliateOffer"("isActive", "priceUpdatedAt");

-- CreateIndex
CREATE INDEX "AffiliateOffer_programCategory_idx" ON "AffiliateOffer"("programCategory");

-- CreateIndex
CREATE INDEX "AffiliateOffer_disclosureKind_idx" ON "AffiliateOffer"("disclosureKind");

-- CreateIndex
CREATE INDEX "AffiliateOffer_network_externalId_idx" ON "AffiliateOffer"("network", "externalId");

-- CreateIndex
CREATE INDEX "ArticleAffiliateOffer_offerId_idx" ON "ArticleAffiliateOffer"("offerId");

-- CreateIndex
CREATE INDEX "ArticleAffiliateOffer_articleId_position_idx" ON "ArticleAffiliateOffer"("articleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseEvent_slug_key" ON "ReleaseEvent"("slug");

-- CreateIndex
CREATE INDEX "ReleaseEvent_releaseDate_idx" ON "ReleaseEvent"("releaseDate");

-- CreateIndex
CREATE INDEX "ReleaseEvent_franchiseId_releaseDate_idx" ON "ReleaseEvent"("franchiseId", "releaseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_email_key" ON "Subscriber"("email");

-- CreateIndex
CREATE INDEX "Subscriber_status_idx" ON "Subscriber"("status");

-- CreateIndex
CREATE INDEX "Subscriber_createdAt_idx" ON "Subscriber"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_isActive_minScoreThreshold_idx" ON "PushSubscription"("isActive", "minScoreThreshold");

-- CreateIndex
CREATE INDEX "PushNotification_status_scheduledFor_idx" ON "PushNotification"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "PushNotification_articleId_idx" ON "PushNotification"("articleId");

-- CreateIndex
CREATE INDEX "PushDelivery_subscriptionId_idx" ON "PushDelivery"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "PushDelivery_notificationId_subscriptionId_key" ON "PushDelivery"("notificationId", "subscriptionId");

-- CreateIndex
CREATE INDEX "FranchiseFollow_visitorId_idx" ON "FranchiseFollow"("visitorId");

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseFollow_franchiseId_visitorId_key" ON "FranchiseFollow"("franchiseId", "visitorId");

-- CreateIndex
CREATE INDEX "CommentAuthor_emailHash_idx" ON "CommentAuthor"("emailHash");

-- CreateIndex
CREATE INDEX "CommentAuthor_isBlocked_idx" ON "CommentAuthor"("isBlocked");

-- CreateIndex
CREATE UNIQUE INDEX "CommentAuthor_provider_providerAccountHash_key" ON "CommentAuthor"("provider", "providerAccountHash");

-- CreateIndex
CREATE UNIQUE INDEX "CommentSession_tokenHash_key" ON "CommentSession"("tokenHash");

-- CreateIndex
CREATE INDEX "CommentSession_authorId_idx" ON "CommentSession"("authorId");

-- CreateIndex
CREATE INDEX "CommentSession_expiresAt_idx" ON "CommentSession"("expiresAt");

-- CreateIndex
CREATE INDEX "Comment_articleId_status_createdAt_idx" ON "Comment"("articleId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Comment_status_createdAt_idx" ON "Comment"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Comment_authorAccountId_idx" ON "Comment"("authorAccountId");

-- CreateIndex
CREATE INDEX "PipelineEvent_eventType_createdAt_idx" ON "PipelineEvent"("eventType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PipelineEvent_topicId_idx" ON "PipelineEvent"("topicId");

-- CreateIndex
CREATE INDEX "PipelineEvent_createdAt_idx" ON "PipelineEvent"("createdAt");

-- CreateIndex
CREATE INDEX "PipelineRun_stage_startedAt_idx" ON "PipelineRun"("stage", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Subcategory" ADD CONSTRAINT "Subcategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Franchise" ADD CONSTRAINT "Franchise_primaryCategoryId_fkey" FOREIGN KEY ("primaryCategoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicFranchise" ADD CONSTRAINT "TopicFranchise_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicFranchise" ADD CONSTRAINT "TopicFranchise_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "Franchise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreSnapshot" ADD CONSTRAINT "ScoreSnapshot_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalReading" ADD CONSTRAINT "SignalReading_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "Subcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleFranchise" ADD CONSTRAINT "ArticleFranchise_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleFranchise" ADD CONSTRAINT "ArticleFranchise_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "Franchise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleTag" ADD CONSTRAINT "ArticleTag_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleTag" ADD CONSTRAINT "ArticleTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveUpdate" ADD CONSTRAINT "LiveUpdate_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleAffiliateOffer" ADD CONSTRAINT "ArticleAffiliateOffer_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleAffiliateOffer" ADD CONSTRAINT "ArticleAffiliateOffer_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "AffiliateOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseEvent" ADD CONSTRAINT "ReleaseEvent_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "Franchise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushNotification" ADD CONSTRAINT "PushNotification_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "PushNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseFollow" ADD CONSTRAINT "FranchiseFollow_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "Franchise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentSession" ADD CONSTRAINT "CommentSession_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "CommentAuthor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorAccountId_fkey" FOREIGN KEY ("authorAccountId") REFERENCES "CommentAuthor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Author"("id") ON DELETE SET NULL ON UPDATE CASCADE;

