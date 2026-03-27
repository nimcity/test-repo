package com.weatherapp.data.model

import com.google.gson.annotations.SerializedName

data class ForecastResponse(
    @SerializedName("cod") val cod: String,
    @SerializedName("cnt") val cnt: Int,
    @SerializedName("list") val list: List<ForecastItem>,
    @SerializedName("city") val city: City
)

data class ForecastItem(
    @SerializedName("dt") val dt: Long,
    @SerializedName("main") val main: Main,
    @SerializedName("weather") val weather: List<Weather>,
    @SerializedName("clouds") val clouds: Clouds,
    @SerializedName("wind") val wind: Wind,
    @SerializedName("visibility") val visibility: Int?,
    @SerializedName("pop") val pop: Double,       // Probability of precipitation
    @SerializedName("dt_txt") val dtTxt: String
)

data class City(
    @SerializedName("id") val id: Long,
    @SerializedName("name") val name: String,
    @SerializedName("coord") val coord: Coord,
    @SerializedName("country") val country: String,
    @SerializedName("timezone") val timezone: Int,
    @SerializedName("sunrise") val sunrise: Long,
    @SerializedName("sunset") val sunset: Long
)

/**
 * A condensed daily summary derived from ForecastItem list.
 */
data class DailyForecast(
    val dateLabel: String,       // e.g. "Mon", "Tue"
    val dateFull: String,        // e.g. "Mon, Mar 27"
    val iconCode: String,
    val description: String,
    val tempMin: Double,
    val tempMax: Double,
    val humidity: Int,
    val windSpeed: Double,
    val pop: Double              // 0..1 precipitation probability
)
