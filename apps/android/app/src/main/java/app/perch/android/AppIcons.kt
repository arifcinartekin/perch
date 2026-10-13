package app.perch.android

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes

/**
 * The launcher icon: the default and five other colourings of the same
 * drawing (scripts/brand.mjs), one activity alias each. Stays on this phone.
 */
object AppIcons {
  data class Choice(val alias: String, @StringRes val name: Int, @DrawableRes val background: Int, @DrawableRes val foreground: Int)

  val choices = listOf(
    Choice("IconNight", R.string.icon_night, R.drawable.ic_launcher_background, R.drawable.ic_launcher_foreground),
    Choice("IconBlack", R.string.icon_black, R.drawable.ic_launcher_background_black, R.drawable.ic_launcher_foreground_black),
    Choice("IconWhite", R.string.icon_white, R.drawable.ic_launcher_background_white, R.drawable.ic_launcher_foreground_white),
    Choice("IconGreen", R.string.icon_green, R.drawable.ic_launcher_background_green, R.drawable.ic_launcher_foreground_green),
    Choice("IconBlue", R.string.icon_blue, R.drawable.ic_launcher_background_blue, R.drawable.ic_launcher_foreground_blue),
    Choice("IconMidnight", R.string.icon_midnight, R.drawable.ic_launcher_background_midnight, R.drawable.ic_launcher_foreground_midnight),
  )

  private fun component(context: Context, alias: String) = ComponentName(context, "${context.packageName}.$alias")

  /** The alias that's on; the manifest's default when none has been changed. */
  fun current(context: Context): String = choices.firstOrNull {
    when (context.packageManager.getComponentEnabledSetting(component(context, it.alias))) {
      PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
      PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> it.alias == choices.first().alias
      else -> false
    }
  }?.alias ?: choices.first().alias

  /** Turns [alias] on and the others off. The launcher may take a moment to show it. */
  fun set(context: Context, alias: String) {
    val pm = context.packageManager
    // The new one first, so there's never a moment without a launcher entry.
    pm.setComponentEnabledSetting(component(context, alias), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
    for (c in choices) {
      if (c.alias != alias) {
        pm.setComponentEnabledSetting(component(context, c.alias), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
      }
    }
  }
}
