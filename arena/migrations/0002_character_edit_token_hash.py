from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('arena', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='character',
            name='edit_token_hash',
            field=models.CharField(blank=True, editable=False, max_length=64),
        ),
    ]
