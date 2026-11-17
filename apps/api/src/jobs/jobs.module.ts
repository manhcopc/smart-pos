import { Global, Module } from "@nestjs/common";
import { BullMqJobsService } from "./bullmq-jobs.service";

@Global()
@Module({
  providers: [BullMqJobsService],
  exports: [BullMqJobsService],
})
export class JobsModule {}
