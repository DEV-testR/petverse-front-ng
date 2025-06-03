import {HttpInterceptorFn, HttpRequest, HttpEvent, HttpErrorResponse, HttpHandlerFn} from '@angular/common/http';
import {inject} from '@angular/core';
import {Observable, throwError, switchMap, BehaviorSubject, filter, take} from 'rxjs';
import {catchError} from 'rxjs/operators';
import {AuthService} from '../services/auth.service';

// ตัวแปรสถานะและ BehaviorSubject ควรอยู่ข้างนอก interceptor เพื่อแชร์สถานะได้ข้าม request
// แต่ถ้าในนี้ชั่วคราวก็ใช้แบบนี้ก่อน
let isRefreshing = false;
let refreshTokenSubject = new BehaviorSubject<string | null>(null);
export const AuthInterceptor: HttpInterceptorFn = (req: HttpRequest<any>, next: HttpHandlerFn): Observable<HttpEvent<any>> => {
    const authService = inject(AuthService);
    const accessToken = authService.getAccessToken();
    let authReq = req;

    if (accessToken) {
        authReq = req.clone({
            setHeaders: {
                Authorization: `Bearer ${accessToken}`
            }
        });
    }

    return next(authReq).pipe(
        catchError(err => {
            if (err instanceof HttpErrorResponse && err.status === 401) {
                if (!isRefreshing) {
                    isRefreshing = true;
                    refreshTokenSubject.next(null);  // แก้ไขตรงนี้
                    authService.removeAccessToken();
                    return authService.refreshToken().pipe(
                        switchMap(() => {
                            isRefreshing = false;
                            const newAccessToken = authService.getAccessToken();
                            if (newAccessToken) {
                                refreshTokenSubject.next(newAccessToken);  // ส่งค่าใหม่
                                const newReq = req.clone({
                                    setHeaders: {
                                        Authorization: `Bearer ${newAccessToken}`
                                    }
                                });
                                return next(newReq);
                            }
                            authService.logout();
                            return throwError(() => err);
                        }),
                        catchError(error => {
                            isRefreshing = false;
                            authService.logout();
                            return throwError(() => error);
                        })
                    );
                } else {
                    // รอให้ refreshToken เสร็จแล้วค่อย retry
                    return refreshTokenSubject.pipe(
                        filter(token => token != null),
                        take(1),
                        switchMap(token => {
                            const newReq = req.clone({
                                setHeaders: {
                                    Authorization: `Bearer ${token!}`
                                }
                            });
                            return next(newReq);
                        })
                    );
                }
            }
            return throwError(() => err);
        })
    );
};
