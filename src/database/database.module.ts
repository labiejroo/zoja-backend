import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";

import { readDatabaseEnv, type TypedConfigService } from "../config/configuration.js";
import { ConfigService } from "@nestjs/config";
import { buildTypeOrmOptions } from "./typeorm.options.js";

/**
 * Połączenie dla aplikacji HTTP.
 *
 * W Lambdzie ten moduł jest budowany raz na środowisko wykonawcze — przy ciepłym
 * wywołaniu pula połączeń już istnieje i nie otwieramy jej od nowa.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: TypedConfigService) => buildTypeOrmOptions(readDatabaseEnv(config)),
    }),
  ],
})
export class DatabaseModule {}
