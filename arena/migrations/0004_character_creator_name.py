from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('arena', '0003_character_forge_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='character',
            name='creator_name',
            field=models.CharField(blank=True, max_length=32),
        ),
    ]
