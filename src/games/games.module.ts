import { Module } from '@nestjs/common';

import { TournamentsModule } from '../tournaments/tournaments.module';
import { AntiCheatModule } from '../anti-cheat/anti-cheat.module';
import { OverworldModule } from '../overworld/overworld.module';
import { SocialModule } from '../social/social.module';

@Module({
  imports: [TournamentsModule, AntiCheatModule, OverworldModule, SocialModule],
  providers: [],
})
export class GamesModule {}
