import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProfileAvatarSetNull1790160342925 implements MigrationInterface {
  name = 'ProfileAvatarSetNull1790160342925';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profile" DROP CONSTRAINT "FK_65588ca8ac212b8357637794d6f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile" ADD CONSTRAINT "FK_65588ca8ac212b8357637794d6f" FOREIGN KEY ("avatarId") REFERENCES "public_file"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profile" DROP CONSTRAINT "FK_65588ca8ac212b8357637794d6f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile" ADD CONSTRAINT "FK_65588ca8ac212b8357637794d6f" FOREIGN KEY ("avatarId") REFERENCES "public_file"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
