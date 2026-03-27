package com.weatherapp.data.api

import com.weatherapp.data.model.ForecastResponse
import com.weatherapp.data.model.WeatherResponse
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Query

interface WeatherApiService {

    /**
     * Fetch current weather by city name.
     * https://api.openweathermap.org/data/2.5/weather?q={city}&appid={key}&units={units}
     */
    @GET("weather")
    suspend fun getCurrentWeatherByCity(
        @Query("q") cityName: String,
        @Query("appid") apiKey: String,
        @Query("units") units: String
    ): Response<WeatherResponse>

    /**
     * Fetch current weather by geographic coordinates.
     * https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={key}&units={units}
     */
    @GET("weather")
    suspend fun getCurrentWeatherByCoords(
        @Query("lat") lat: Double,
        @Query("lon") lon: Double,
        @Query("appid") apiKey: String,
        @Query("units") units: String
    ): Response<WeatherResponse>

    /**
     * Fetch 5-day / 3-hour forecast by city name.
     * https://api.openweathermap.org/data/2.5/forecast?q={city}&appid={key}&units={units}&cnt=40
     */
    @GET("forecast")
    suspend fun getForecastByCity(
        @Query("q") cityName: String,
        @Query("appid") apiKey: String,
        @Query("units") units: String,
        @Query("cnt") count: Int = 40
    ): Response<ForecastResponse>

    /**
     * Fetch 5-day / 3-hour forecast by coordinates.
     */
    @GET("forecast")
    suspend fun getForecastByCoords(
        @Query("lat") lat: Double,
        @Query("lon") lon: Double,
        @Query("appid") apiKey: String,
        @Query("units") units: String,
        @Query("cnt") count: Int = 40
    ): Response<ForecastResponse>
}
